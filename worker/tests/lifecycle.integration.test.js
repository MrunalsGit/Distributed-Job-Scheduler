// Verifies the pieces the dashboard's job detail page depends on: that
// running a job through the real lifecycle actually writes to job_executions
// and job_logs, not just flips the jobs.status column.
const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const { claimJobs, markRunning, markCompleted, handleFailure } = require('../src/jobRepository');

const describeIfDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

async function resetTables() {
  await pool.query(
    'TRUNCATE jobs, queues, projects, users, retry_policies, job_executions, job_logs, dead_letter_queue, workers RESTART IDENTITY CASCADE'
  );
}

async function seedQueue() {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ('t@test.com', 'x') RETURNING id`
  );
  const { rows: [project] } = await pool.query(
    `INSERT INTO projects (owner_id, name) VALUES ($1, 'p') RETURNING id`,
    [user.id]
  );
  const { rows: [queue] } = await pool.query(
    `INSERT INTO queues (project_id, name, concurrency_limit) VALUES ($1, 'q', 10) RETURNING id`,
    [project.id]
  );
  return queue.id;
}

// job_executions.worker_id has a foreign key to workers, so tests need a real
// registered worker row - same as production, where the worker process calls
// registerWorker() on startup before it can ever claim a job.
async function seedWorker() {
  const workerId = randomUUID();
  await pool.query(
    `INSERT INTO workers (id, name, status, max_concurrency) VALUES ($1, 'test-worker', 'idle', 5)`,
    [workerId]
  );
  return workerId;
}

async function insertQueuedJob(queueId) {
  const { rows: [job] } = await pool.query(
    `INSERT INTO jobs (queue_id, type, payload, run_at) VALUES ($1, 'immediate', '{}', now()) RETURNING *`,
    [queueId]
  );
  return job;
}

describeIfDb('job lifecycle logging (integration)', () => {
  beforeEach(resetTables);
  afterAll(() => pool.end());

  test('a successful run writes a claimed log, a started log, a completed execution row, and a completed log', async () => {
    const queueId = await seedQueue();
    const job = await insertQueuedJob(queueId);
    const workerId = await seedWorker();

    const [claimed] = await claimJobs(pool, { queueId, workerId, limit: 1 });
    const executionId = await markRunning(pool, claimed, workerId);
    await markCompleted(pool, claimed.id, executionId);

    const { rows: logs } = await pool.query(
      'SELECT event_type FROM job_logs WHERE job_id = $1 ORDER BY created_at',
      [job.id]
    );
    expect(logs.map((l) => l.event_type)).toEqual(['claimed', 'started', 'completed']);

    const { rows: executions } = await pool.query('SELECT * FROM job_executions WHERE job_id = $1', [job.id]);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('completed');
    expect(executions[0].attempt_number).toBe(1);
    expect(executions[0].finished_at).not.toBeNull();
  });

  test('a failure that gets retried logs the error and updates the execution row', async () => {
    const queueId = await seedQueue();
    const job = await insertQueuedJob(queueId);
    const workerId = await seedWorker();
    const retryPolicy = { strategy: 'fixed', base_delay_ms: 100, max_attempts: 5 };

    const [claimed] = await claimJobs(pool, { queueId, workerId, limit: 1 });
    const executionId = await markRunning(pool, claimed, workerId);
    const result = await handleFailure(pool, claimed, 'boom', retryPolicy, executionId);

    expect(result).toBe('requeued');

    const { rows: executions } = await pool.query('SELECT * FROM job_executions WHERE id = $1', [executionId]);
    expect(executions[0].status).toBe('failed');
    expect(executions[0].error_message).toBe('boom');

    const { rows: jobs } = await pool.query('SELECT status, attempt_count FROM jobs WHERE id = $1', [job.id]);
    expect(jobs[0].status).toBe('queued');
    expect(jobs[0].attempt_count).toBe(1);

    const { rows: logs } = await pool.query(
      'SELECT event_type FROM job_logs WHERE job_id = $1 ORDER BY created_at',
      [job.id]
    );
    expect(logs.map((l) => l.event_type)).toEqual(['claimed', 'started', 'retried']);
  });

  test('exhausting retries dead-letters the job and logs it', async () => {
    const queueId = await seedQueue();
    const job = await insertQueuedJob(queueId);
    const workerId = await seedWorker();
    const retryPolicy = { strategy: 'fixed', base_delay_ms: 100, max_attempts: 1 };

    const [claimed] = await claimJobs(pool, { queueId, workerId, limit: 1 });
    const executionId = await markRunning(pool, claimed, workerId);
    const result = await handleFailure(pool, claimed, 'fatal', retryPolicy, executionId);

    expect(result).toBe('dead_lettered');

    const { rows: jobs } = await pool.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(jobs[0].status).toBe('dead');

    const { rows: dlq } = await pool.query('SELECT * FROM dead_letter_queue WHERE job_id = $1', [job.id]);
    expect(dlq).toHaveLength(1);
    expect(dlq[0].reason).toBe('fatal');

    const { rows: logs } = await pool.query(
      'SELECT event_type FROM job_logs WHERE job_id = $1 ORDER BY created_at',
      [job.id]
    );
    expect(logs.map((l) => l.event_type)).toEqual(['claimed', 'started', 'dead_lettered']);
  });
});
