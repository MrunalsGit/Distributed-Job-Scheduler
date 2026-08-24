const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { ConflictError, ValidationError } = require('../utils/errors');
const { validateBody } = require('../middleware/validate');
const { signupSchema, loginSchema } = require('../schemas');

const router = express.Router();

router.post('/signup', validateBody(signupSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length) throw new ConflictError('An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new ValidationError('Invalid credentials');
    }

    const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });
    res.json({ data: { token } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
