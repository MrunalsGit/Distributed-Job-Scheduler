const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { NotFoundError } = require('../utils/errors');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

const router = express.Router();
router.use(requireAuth);

router.get('/dlq', async (req, res, next) => {
  try {
    const pg = parsePagination(req.query);
    const { queueId } = req.query;

    const conditions = [];
    const params = [];
    let jobJoin = '';
    if (queueId) {
      jobJoin = 'JOIN jobs j ON j.id = d.job_id';
      conditions.push(`j.queue_id = $${params.length + 1}`);
      params.push(queueId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT d.* FROM dead_letter_queue d ${jobJoin} ${where}
       ORDER BY d.failed_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pg.limit, pg.offset]
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM dead_letter_queue d ${jobJoin} ${where}`,
      params
    );
    res.json(paginatedResponse(rows, Number(countRows[0].count), pg));
  } catch (err) {
    next(err);
  }
});

// Moves a deadlettered job back to queued
// resets its attempt count 
router.post('/dlq/:id/requeue', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: dlqRows } = await client.query(
      'SELECT * FROM dead_letter_queue WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (!dlqRows[0]) throw new NotFoundError('Dead letter entry not found');

    const { rows: jobRows } = await client.query(
      `UPDATE jobs SET status = 'queued', attempt_count = 0, run_at = now(), worker_id = NULL, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [dlqRows[0].job_id]
    );
    await client.query('DELETE FROM dead_letter_queue WHERE id = $1', [req.params.id]);

    await client.query('COMMIT');
    res.json({ data: jobRows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
