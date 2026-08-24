
// Atomically claims up to `limit` due jobs from a queue for this worker
// SKIP LOCKED means two workers racing on the same queue never grab the same row
// this solved my prob only using postgres, without using external lock

// The LIMIT is capped by the queues own concurrency_limit minus jobs already claimed/running for that queue
// so a queue's configured concurrency is respected even when multiple worker processes are pulling from it
async function claimJobs(pool, { queueId, workerId, limit }) {
  const { rows } = await pool.query(
    `UPDATE jobs
     SET status = 'claimed', worker_id = $2, claimed_at = now(), updated_at = now()
     WHERE id IN (
       SELECT id FROM jobs
       WHERE queue_id = $1 AND status = 'queued' AND run_at <= now()
       ORDER BY priority DESC, run_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT GREATEST(0, LEAST(
         $3,
         (SELECT concurrency_limit FROM queues WHERE id = $1)
           - (SELECT COUNT(*) FROM jobs WHERE queue_id = $1 AND status IN ('claimed', 'running'))
       ))
     )
     RETURNING *`,
    [queueId, workerId, limit]
  );

  // Log the claim event for each job
  for (const job of rows) {
    await logEvent(pool, job.id, 'claimed', `Claimed by worker ${workerId}`);
  }

  return rows;
}

// Fetches queue config (concurrency limit, pause state) once per poll so pause/resume and config edits made from the dashboard take effect quickly
// without restarting the worker.
async function getQueueConfig(pool, queueId) {
  const { rows } = await pool.query(
    `SELECT q.id, q.is_paused, q.concurrency_limit, rp.strategy, rp.base_delay_ms, rp.max_attempts
     FROM queues q
     LEFT JOIN retry_policies rp ON rp.id = q.retry_policy_id
     WHERE q.id = $1`,
    [queueId]
  );
  return rows[0] || null;
}

async function logEvent(pool, jobId, eventType, message = null) {
  await pool.query(`INSERT INTO job_logs (job_id, event_type, message) VALUES ($1, $2, $3)`, [
    jobId,
    eventType,
    message,
  ]);
}

async function markRunning(pool, job, workerId) {
  await pool.query(
    `UPDATE jobs SET status = 'running', started_at = now(), updated_at = now() WHERE id = $1`,
    [job.id]
  );
  // Opens the job_executions row for this attempt 
  // attempt_count + 1 because attempt_count only increments on requeue the very first run is attempt 1
  const { rows } = await pool.query(
    `INSERT INTO job_executions (job_id, worker_id, attempt_number, status, started_at)
     VALUES ($1, $2, $3, 'running', now()) RETURNING id`,
    [job.id, workerId, job.attempt_count + 1]
  );
  await logEvent(pool, job.id, 'started', `Attempt ${job.attempt_count + 1} started`);
  return rows[0].id;
}

async function markCompleted(pool, jobId, executionId) {
  await pool.query(
    `UPDATE jobs SET status = 'completed', finished_at = now(), updated_at = now() WHERE id = $1`,
    [jobId]
  );
  await pool.query(
    `UPDATE job_executions
     SET status = 'completed', finished_at = now(), duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000
     WHERE id = $1`,
    [executionId]
  );
  await logEvent(pool, jobId, 'completed');
}

// requeue with backoff or move to DLQ if exhausted
async function handleFailure(pool, job, errorMessage, retryPolicy, executionId) {
  await pool.query(
    `UPDATE job_executions
     SET status = 'failed', finished_at = now(), error_message = $2,
         duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000
     WHERE id = $1`,
    [executionId, errorMessage]
  );

  const nextAttempt = job.attempt_count + 1;

  if (nextAttempt >= retryPolicy.max_attempts) {
    await pool.query('BEGIN');
    try {
      await pool.query(
        `INSERT INTO dead_letter_queue (job_id, reason, payload_snapshot) VALUES ($1, $2, $3)`,
        [job.id, errorMessage, job.payload]
      );
      await pool.query(`UPDATE jobs SET status = 'dead', updated_at = now() WHERE id = $1`, [job.id]);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
    await logEvent(pool, job.id, 'dead_lettered', errorMessage);
    return 'dead_lettered';
  }

  const delayMs = computeBackoff(retryPolicy, nextAttempt);
  await pool.query(
    `UPDATE jobs
     SET status = 'queued', attempt_count = $2, run_at = now() + ($3 || ' milliseconds')::interval,
         worker_id = NULL, updated_at = now()
     WHERE id = $1`,
    [job.id, nextAttempt, delayMs]
  );
  await logEvent(pool, job.id, 'retried', `${errorMessage} — retrying in ${delayMs}ms`);
  return 'requeued';
}

function computeBackoff(policy, attempt) {
  switch (policy.strategy) {
    case 'fixed':
      return policy.base_delay_ms;
    case 'linear':
      return policy.base_delay_ms * attempt;
    case 'exponential':
      return Math.min(policy.base_delay_ms * 2 ** attempt, 5 * 60 * 1000); // capped at 5 min
    default:
      return policy.base_delay_ms;
  }
}

// Finds jobs stuck in claimed/running whose worker has missed heartbeats the "reaper".
async function reapOrphanedJobs(pool, staleMs) {
  const { rows } = await pool.query(
    `UPDATE jobs SET status = 'queued', worker_id = NULL, updated_at = now()
     WHERE status IN ('claimed', 'running')
       AND worker_id IN (
         SELECT id FROM workers w
         WHERE NOT EXISTS (
           SELECT 1 FROM worker_heartbeats h
           WHERE h.worker_id = w.id AND h.heartbeat_at > now() - ($1 || ' milliseconds')::interval
         )
       )
     RETURNING id`,
    [staleMs]
  );
  return rows;
}

module.exports = {
  claimJobs,
  markRunning,
  markCompleted,
  handleFailure,
  computeBackoff,
  reapOrphanedJobs,
  getQueueConfig,
  logEvent,
};
