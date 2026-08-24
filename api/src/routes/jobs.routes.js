const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { createJobSchema } = require('../schemas');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

const router = express.Router();
router.use(requireAuth);

router.post('/queues/:queueId/jobs', validateBody(createJobSchema), async (req, res, next) => {
  try {
    const { type, payload, runAt, cronExpression, idempotencyKey, items } = req.body;

    // recurring and scheduled jobs go through scheduled_jobs
    // the scheduler process promotes them into real job rows when due
    if (type === 'recurring' || type === 'scheduled') {
      if (type === 'recurring' && !cronExpression) {
        throw new ValidationError('cronExpression is required for recurring jobs');
      }
      const { rows } = await pool.query(
        `INSERT INTO scheduled_jobs (queue_id, cron_expression, job_template, next_run_at)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.queueId, cronExpression || null, { type: 'scheduled', payload }, runAt || new Date()]
      );
      return res.status(201).json({ data: rows[0] });
    }

    // batch job contains mult items
    // rather than being treated as a single immediate job
    // Each sub job is independently claimed, retried and can fail without affecting siblings
    if (type === 'batch') {
      if (!items || !items.length) {
        throw new ValidationError('items (a non-empty array) is required for batch jobs');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const created = [];
        for (const item of items) {
          const { rows } = await client.query(
            `INSERT INTO jobs (queue_id, type, payload, run_at) VALUES ($1, 'immediate', $2, $3) RETURNING *`,
            [req.params.queueId, item, runAt || new Date()]
          );
          created.push(rows[0]);
        }
        await client.query('COMMIT');
        return res.status(201).json({ data: created });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // Immediate and delayed jobs are inserted directly into jobs
    const { rows } = await pool.query(
      `INSERT INTO jobs (queue_id, type, payload, run_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.queueId, type, payload, runAt || new Date(), idempotencyKey || null]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    if (err.code === '23505') return next(new ValidationError('A job with this idempotency key already exists'));
    next(err);
  }
});

router.get('/queues/:queueId/jobs', async (req, res, next) => {
  try {
    const pg = parsePagination(req.query);
    const { status } = req.query;

    const conditions = ['queue_id = $1'];
    const params = [req.params.queueId];
    if (status) {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    const { rows } = await pool.query(
      `SELECT * FROM jobs WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pg.limit, pg.offset]
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM jobs WHERE ${conditions.join(' AND ')}`,
      params
    );
    res.json(paginatedResponse(rows, Number(countRows[0].count), pg));
  } catch (err) {
    next(err);
  }
});

router.get('/jobs/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new NotFoundError('Job not found');

    const { rows: executions } = await pool.query(
      'SELECT * FROM job_executions WHERE job_id = $1 ORDER BY started_at DESC',
      [req.params.id]
    );
    const { rows: logs } = await pool.query(
      'SELECT * FROM job_logs WHERE job_id = $1 ORDER BY created_at',
      [req.params.id]
    );

    res.json({ data: { ...rows[0], executions, logs } });
  } catch (err) {
    next(err);
  }
});

router.post('/jobs/:id/retry', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE jobs SET status = 'queued', run_at = now(), worker_id = NULL
       WHERE id = $1 AND status IN ('failed', 'dead') RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) throw new NotFoundError('Job not found or not retryable');
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
