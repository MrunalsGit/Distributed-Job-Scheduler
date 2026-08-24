const { Pool } = require('pg');

const pool = new Pool({                                       // One shared pool per process for api worker and scheduler
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
});

pool.on('error', (err) => {
  // Idle client errors (e.g. connection dropped) should not crash the process.
  console.error('Unexpected Postgres pool error', err);
});

module.exports = { pool };
