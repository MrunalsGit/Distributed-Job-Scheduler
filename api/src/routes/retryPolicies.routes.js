const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { createRetryPolicySchema } = require('../schemas');

const router = express.Router();
router.use(requireAuth);

router.get('/retry-policies', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM retry_policies ORDER BY created_at DESC');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/retry-policies', validateBody(createRetryPolicySchema), async (req, res, next) => {
  try {
    const { strategy, baseDelayMs, maxAttempts } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO retry_policies (strategy, base_delay_ms, max_attempts) VALUES ($1, $2, $3) RETURNING *`,
      [strategy, baseDelayMs, maxAttempts]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
