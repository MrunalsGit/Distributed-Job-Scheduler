require('dotenv').config();
const { Pool } = require('pg');
const parser = require('cron-parser');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TICK_INTERVAL_MS = Number(process.env.SCHEDULER_TICK_MS || 5000);
const REAPER_INTERVAL_MS = Number(process.env.REAPER_INTERVAL_MS || 15000);
// A worker is considered dead if it hasn't sent a heartbeat in this time period
// should be a few multiples of the workers own HEARTBEAT_INTERVAL_MS
const REAPER_STALE_MS = Number(process.env.REAPER_STALE_MS || 20000);

// Promotes any scheduled_jobs row whose next_run_at has passed into a real job row
// then computes the next occurrence for recurring (cron) entries
async function tick() {
  const { rows: due } = await pool.query(
    `SELECT * FROM scheduled_jobs WHERE is_active = true AND next_run_at <= now()`
  );

  for (const entry of due) {
    await pool.query(
      `INSERT INTO jobs (queue_id, type, payload, run_at)
       VALUES ($1, $2, $3, now())`,
      [entry.queue_id, entry.job_template.type || 'scheduled', entry.job_template.payload || {}]
    );

    if (entry.cron_expression) {
      const next = parser.parseExpression(entry.cron_expression).next().toDate();
      await pool.query(`UPDATE scheduled_jobs SET next_run_at = $2 WHERE id = $1`, [entry.id, next]);
    } else {
      // one-off delayed job: deactivate after firing once
      await pool.query(`UPDATE scheduled_jobs SET is_active = false WHERE id = $1`, [entry.id]);
    }
  }
}

// Requeues jobs stuck in claimed or running because their worker died without sending a heartbeat
// otherwise a crashed worker orphans jobs permanently
async function reapTick() {
  const { rows: reaped } = await pool.query(
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
    [REAPER_STALE_MS]
  );
  if (reaped.length > 0) {
    console.log(`Reaper requeued ${reaped.length} orphaned job(s): ${reaped.map((r) => r.id).join(', ')}`);
  }
}

setInterval(() => {
  tick().catch((err) => console.error('Scheduler tick failed', err));
}, TICK_INTERVAL_MS);

setInterval(() => {
  reapTick().catch((err) => console.error('Reaper tick failed', err));
}, REAPER_INTERVAL_MS);

console.log('Scheduler started (job promotion + orphan reaper)');
