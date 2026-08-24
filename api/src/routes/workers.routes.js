const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { NotFoundError } = require('../utils/errors');

const router = express.Router();
router.use(requireAuth);

// Includes each workers most recent heartbeat so the dashboard can show
// "last seen Xs ago" and flag workers that have gone quiet
router.get('/workers', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, MAX(h.heartbeat_at) AS last_heartbeat_at
       FROM workers w
       LEFT JOIN worker_heartbeats h ON h.worker_id = w.id
       GROUP BY w.id
       ORDER BY w.started_at DESC`
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/workers/:id/jobs', async (req, res, next) => {
  try {
    const { rows: worker } = await pool.query('SELECT id FROM workers WHERE id = $1', [req.params.id]);
    if (!worker[0]) throw new NotFoundError('Worker not found');

    const { rows } = await pool.query(
      `SELECT * FROM jobs WHERE worker_id = $1 AND status IN ('claimed', 'running') ORDER BY claimed_at DESC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
