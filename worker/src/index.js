require('dotenv').config();
const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const { claimJobs, markRunning, markCompleted, handleFailure, getQueueConfig } = require('./jobRepository');
const { runHandler } = require('./jobHandlers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const WORKER_ID = randomUUID();
const QUEUE_ID = process.env.QUEUE_ID; // one worker process serves one queue in this simple setup
const MAX_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 5);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1500);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 5000);
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS || 10000);
const DEFAULT_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS || 30000);

const running = new Map(); 
let shuttingDown = false;

async function registerWorker() {
  await pool.query(
    `INSERT INTO workers (id, name, status, max_concurrency) VALUES ($1, $2, 'idle', $3)`,
    [WORKER_ID, `worker-${WORKER_ID.slice(0, 8)}`, MAX_CONCURRENCY]
  );
}

async function sendHeartbeat() {
  await pool.query(`INSERT INTO worker_heartbeats (worker_id) VALUES ($1)`, [WORKER_ID]);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Job timed out')), ms)),
  ]);
}

async function executeJob(job, retryPolicy) {
  let executionId;
  try {
    executionId = await markRunning(pool, job, WORKER_ID);
    await withTimeout(runHandler(job), job.timeout_ms || DEFAULT_TIMEOUT_MS);
    await markCompleted(pool, job.id, executionId);
  } catch (err) {
    // executionId may be undefined if markRunning itself threw guard
    // so a DB hiccup on the running transition doesnt crash the whole worker
    if (typeof executionId !== 'undefined') {
      await handleFailure(pool, job, err.message, retryPolicy, executionId);
    } else {
      console.error(`Failed to record execution start for job ${job.id}`, err);
    }
  }
}

// Fallback used only if a queue has no retry_policy_id set
const DEFAULT_RETRY_POLICY = { strategy: 'exponential', base_delay_ms: 1000, max_attempts: 5 };

async function pollLoop() {
  if (shuttingDown) return;

  try {
    const queue = await getQueueConfig(pool, QUEUE_ID);
    if (!queue) {
      console.warn(`Queue ${QUEUE_ID} not found — retrying next tick`);
    } else if (queue.is_paused) {
      // Paused queues are skipped entirely; nothing is claimed until resumed.
    } else {
      const freeSlots = MAX_CONCURRENCY - running.size;
      if (freeSlots > 0) {
        const jobs = await claimJobs(pool, { queueId: QUEUE_ID, workerId: WORKER_ID, limit: freeSlots });
        const retryPolicy = queue.strategy
          ? { strategy: queue.strategy, base_delay_ms: queue.base_delay_ms, max_attempts: queue.max_attempts }
          : DEFAULT_RETRY_POLICY;
        for (const job of jobs) {
          const promise = executeJob(job, retryPolicy).finally(() => running.delete(job.id));
          running.set(job.id, promise);
        }
      }
    }
  } catch (err) {
    console.error('Poll loop error', err);
  }

  setTimeout(pollLoop, POLL_INTERVAL_MS);
}

async function shutdown() {
  console.log('Shutting down worker gracefully...');
  shuttingDown = true;

  const drained = Promise.all(running.values());
  const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
  await Promise.race([drained, timeout]);

  if (running.size > 0) {
    await pool.query(
      `UPDATE jobs SET status = 'queued', worker_id = NULL WHERE id = ANY($1)`,
      [[...running.keys()]]
    );
  }

  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

(async () => {
  await registerWorker();
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  pollLoop();
  console.log(`Worker ${WORKER_ID} started, watching queue ${QUEUE_ID}`);
})();
