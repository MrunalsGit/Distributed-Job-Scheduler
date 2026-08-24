const express = require('express');
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { createProjectSchema } = require('../schemas');
const { NotFoundError } = require('../utils/errors');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const pg = parsePagination(req.query);
    const { rows } = await pool.query(
      'SELECT * FROM projects WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.user.sub, pg.limit, pg.offset]
    );
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) FROM projects WHERE owner_id = $1',
      [req.user.sub]
    );
    res.json(paginatedResponse(rows, Number(countRows[0].count), pg));
  } catch (err) {
    next(err);
  }
});

router.post('/', validateBody(createProjectSchema), async (req, res, next) => {
  try {
    const { name } = req.body;

    const { rows } = await pool.query(
      'INSERT INTO projects (owner_id, name) VALUES ($1, $2) RETURNING *',
      [req.user.sub, name]
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1 AND owner_id = $2', [
      req.params.id,
      req.user.sub,
    ]);
    if (!rows[0]) throw new NotFoundError('Project not found');
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', validateBody(createProjectSchema), async (req, res, next) => {
  try {
    const { name } = req.body;

    const { rows } = await pool.query(
      'UPDATE projects SET name = $1 WHERE id = $2 AND owner_id = $3 RETURNING *',
      [name, req.params.id, req.user.sub]
    );
    if (!rows[0]) throw new NotFoundError('Project not found');
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM projects WHERE id = $1 AND owner_id = $2', [
      req.params.id,
      req.user.sub,
    ]);
    if (!rowCount) throw new NotFoundError('Project not found');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
