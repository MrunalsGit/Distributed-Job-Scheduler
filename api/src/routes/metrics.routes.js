const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// High level counts for the dashboards top summary bar
router.get('/metrics/overview', async (req, res, next) => {
  try {
    const [jobsByStatus, workerCounts, dlqCount] = await Promise.all([
      pool.query('SELECT status, COUNT(*) FROM jobs GROUP BY status'),
      pool.query('SELECT status, COUNT(*) FROM workers GROUP BY status'),
      pool.query('SELECT COUNT(*) FROM dead_letter_queue'),
    ]);

    res.json({
      data: {
        jobsByStatus: Object.fromEntries(jobsByStatus.rows.map((r) => [r.status, Number(r.count)])),
        workersByStatus: Object.fromEntries(workerCounts.rows.map((r) => [r.status, Number(r.count)])),
        deadLetterCount: Number(dlqCount.rows[0].count),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Completed jobs per minute over the last hour, for the throughput chart
router.get('/metrics/throughput', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT date_trunc('minute', finished_at) AS minute, COUNT(*) AS completed
       FROM jobs
       WHERE status = 'completed' AND finished_at > now() - interval '1 hour'
       GROUP BY minute
       ORDER BY minute`
    );
    res.json({ data: rows.map((r) => ({ minute: r.minute, completed: Number(r.completed) })) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
