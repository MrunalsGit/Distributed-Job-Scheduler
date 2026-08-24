require('dotenv').config();
const express = require('express');
const { errorHandler } = require('./utils/errors');

const authRoutes = require('./routes/auth.routes');
const projectRoutes = require('./routes/projects.routes');
const queueRoutes = require('./routes/queues.routes');
const jobRoutes = require('./routes/jobs.routes');
const dlqRoutes = require('./routes/dlq.routes');
const metricsRoutes = require('./routes/metrics.routes');
const workerRoutes = require('./routes/workers.routes');
const retryPolicyRoutes = require('./routes/retryPolicies.routes');

const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// request logger: request id + duration on every request
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api', queueRoutes); // /api/projects/:id/queues, /api/queues/:id
app.use('/api', jobRoutes);   // /api/queues/:id/jobs, /api/jobs/:id
app.use('/api', dlqRoutes);   // /api/dlq, /api/dlq/:id/requeue
app.use('/api', metricsRoutes); // /api/metrics/overview, /api/metrics/throughput
app.use('/api', workerRoutes);  // /api/workers, /api/workers/:id/jobs
app.use('/api', retryPolicyRoutes); // /api/retry-policies

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Must be registered last.
app.use(errorHandler);

module.exports = { app };
