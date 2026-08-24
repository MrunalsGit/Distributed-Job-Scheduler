-- Run with: psql $DATABASE_URL -f db/migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE retry_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy TEXT NOT NULL CHECK (strategy IN ('fixed', 'linear', 'exponential')),
  base_delay_ms INTEGER NOT NULL DEFAULT 1000,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  retry_policy_id UUID REFERENCES retry_policies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  concurrency_limit INTEGER NOT NULL DEFAULT 5,
  is_paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  depends_on UUID REFERENCES jobs(id) ON DELETE SET NULL, -- for workflow dependencies
  type TEXT NOT NULL CHECK (type IN ('immediate', 'delayed', 'scheduled', 'recurring', 'batch')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'claimed', 'running', 'completed', 'failed', 'dead')),
  payload JSONB NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  worker_id UUID,
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- matches exactly what the claim query filters/sorts on
CREATE INDEX idx_jobs_claim ON jobs (queue_id, status, run_at) WHERE status = 'queued';
CREATE UNIQUE INDEX idx_jobs_idempotency ON jobs (queue_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  cron_expression TEXT,        -- null for one off delayed jobs
  job_template JSONB NOT NULL, -- payload/type to stamp onto the new job row
  next_run_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_jobs_due ON scheduled_jobs (next_run_at) WHERE is_active = true;

CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'busy', 'dead')),
  max_concurrency INTEGER NOT NULL DEFAULT 5,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE worker_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_heartbeats_worker ON worker_heartbeats (worker_id, heartbeat_at DESC);

CREATE TABLE job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT
);

CREATE INDEX idx_executions_job ON job_executions (job_id, started_at DESC);

CREATE TABLE job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- e.g. 'claimed', 'started', 'retried', 'failed', 'completed'
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_logs_job ON job_logs (job_id, created_at);

CREATE TABLE dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  payload_snapshot JSONB NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
