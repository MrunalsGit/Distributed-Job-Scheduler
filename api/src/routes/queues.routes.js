const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { createQueueSchema, updateQueueSchema } = require('../schemas');
const { NotFoundError, ValidationError } = require('../utils/errors');

const router = express.Router();
router.use(requireAuth);

router.get('/projects/:projectId/queues', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM queues WHERE project_id = $1 ORDER BY created_at', [
      req.params.projectId,
    ]);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/projects/:projectId/queues', validateBody(createQueueSchema), async (req, res, next) => {
  try {
    const { name, priority, concurrencyLimit, retryPolicyId = null } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO queues (project_id, name, priority, concurrency_limit, retry_policy_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.projectId, name, priority, concurrencyLimit, retryPolicyId]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/queues/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM queues WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new NotFoundError('Queue not found');
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/queues/:id', validateBody(updateQueueSchema), async (req, res, next) => {
  try {
    const { name, priority, concurrencyLimit, retryPolicyId } = req.body;

    // Build the SET clause dynamically from whichever fields were provided and avoids overwriting fields the caller didn't intend to touch
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push(`name = $${params.length + 1}`); params.push(name); }
    if (priority !== undefined) { fields.push(`priority = $${params.length + 1}`); params.push(priority); }
    if (concurrencyLimit !== undefined) {
      fields.push(`concurrency_limit = $${params.length + 1}`);
      params.push(concurrencyLimit);
    }
    if (retryPolicyId !== undefined) {
      fields.push(`retry_policy_id = $${params.length + 1}`);
      params.push(retryPolicyId);
    }
    if (!fields.length) throw new ValidationError('No updatable fields provided');

    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE queues SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) throw new NotFoundError('Queue not found');
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/queues/:id/pause', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE queues SET is_paused = true WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows[0]) throw new NotFoundError('Queue not found');
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/queues/:id/resume', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'UPDATE queues SET is_paused = false WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows[0]) throw new NotFoundError('Queue not found');
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Aggregate stats computed on read
router.get('/queues/:id/stats', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT status, COUNT(*) FROM jobs WHERE queue_id = $1 GROUP BY status`,
      [req.params.id]
    );
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
    res.json({ data: byStatus });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
