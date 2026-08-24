# Distributed job scheduler

A production-inspired job scheduling platform: an API server, a worker pool, a
scheduler process, and a React dashboard, all coordinated through a single
PostgreSQL database.

## Why this design

- **Postgres only, no Redis/Kafka.** Job claiming uses `SELECT ... FOR UPDATE SKIP LOCKED`,
  which gives atomic, duplicate-free job claiming with zero extra infrastructure.
  See `docs/design-decisions.md` for the full reasoning and tradeoffs.
- **Three independent processes** (`api`, `worker`, `scheduler`) so that API traffic,
  job scheduling, and job execution never compete with each other for resources.
- **Modular by design** — bonus features (workflow dependencies, RBAC, WebSocket
  live updates) slot in without restructuring; see "Extending later" below.

## Repo layout

api/ Express REST API — auth, projects, queues, jobs, dashboard reads
worker/ Polls queues, claims jobs atomically, executes, retries, heartbeats
scheduler/ Promotes due delayed/cron jobs into real job rows, reaps orphans
db/ SQL migrations
dashboard/ React dashboard (queue health, job explorer, workers, DLQ, metrics)
docs/ Architecture diagram, ER diagram, OpenAPI spec, design decisions


## Docs

- `docs/architecture.png` — process/data-flow diagram
- `docs/erd.png` — full entity-relationship diagram
- `docs/openapi.yaml` — complete API reference (open in https://editor.swagger.io
  or any OpenAPI viewer)
- `docs/design-decisions.md` — the reasoning behind every major tradeoff, written
  for exactly the kind of "why didn't you use X" questions a reviewer will ask

## Setup (local, without Docker)

1. Start Postgres: `docker compose up -d postgres` (or run Postgres however you
   normally would — Docker is only used here for convenience, not required)
2. Copy env file: `cp .env.example .env` (fill in `JWT_SECRET`)
3. **Copy `.env` into each service folder** — `api`, `worker`, and `scheduler`
   are separate processes, and each loads its own `.env` from its own
   directory rather than the project root:

cp .env api/.env
cp .env worker/.env
cp .env scheduler/.env

4. Run the migration: `npm run migrate`
5. Install dependencies: `npm install` (installs api, worker, scheduler
   workspaces together)
6. Start the API and scheduler, each in its own terminal:

npm run dev:api
npm run dev:scheduler

7. Dashboard: `cd dashboard && npm install && npm run dev`, then open
   http://localhost:5173, sign up, and create a project + queue.
8. **Start a worker, pointed at that queue.** Each worker process watches
   exactly one queue, set via the `QUEUE_ID` environment variable — this is a
   deliberate design choice (see `docs/design-decisions.md`), not a missing
   feature. Get the queue's id one of two ways:
   - From the dashboard's URL bar while viewing that queue
     (`http://localhost:5173/queues/<this-part-is-the-id>`), or
   - Directly from the database, which also shows every queue at once if
     you've created more than one:
 psql "$DATABASE_URL" -c "SELECT id, name FROM queues;"

   Then start the worker:

cd worker
QUEUE_ID=<paste-queue-id> npm run dev


   Submitted jobs will sit in `queued` status until a worker watching that
   specific queue is running — this is expected, not a bug, and a good thing
   to demo: submit a job with no worker running, show it staying `queued`,
   then start the worker and watch it complete.

## Setup (fully Dockerized)

docker compose up -d --build postgres api scheduler dashboard


The `worker` service needs a real `QUEUE_ID` to watch, which only exists after
you've created a queue through the API/dashboard — so bring the rest up first,
create a project + queue from the dashboard (http://localhost:8080), find the
queue's id the same way as above, then:

QUEUE_ID=<queue id> docker compose up -d --build worker


## Demoing the reliability features

The worker ships with a few purpose-built handlers (`worker/src/jobHandlers.js`)
specifically so you can demo the full lifecycle without external dependencies:

- `{"handler": "noop"}` — always succeeds instantly.
- `{"handler": "send-email", "to": "a@b.com"}` — succeeds; omit `to` to see a
  validation failure go through the retry path.
- `{"handler": "generate-report", "rows": 500}` — takes a moment, good for
  demoing concurrent execution in the job explorer.
- `{"handler": "flaky-task", "failTimes": 2, "__flakyKey": "demo-1"}` — fails
  twice, then succeeds. Submit this and watch `attempt_count` climb in the
  dashboard as it requeues with backoff, then complete.
- `{"handler": "always-fail"}` — always fails. Use this with a queue whose
  retry policy has a low `max_attempts` to quickly see a job land in the dead
  letter queue.

Submit any of these from the queue detail page's "Submit a test job" form.

## Running tests

Two tiers:

- **Unit tests** (`worker/tests/jobRepository.test.js`, `jobHandlers.test.js`) —
  pure functions like backoff math and handler logic, no database needed.
  These always run.
- **Integration tests** (`worker/tests/claim.integration.test.js`,
  `worker/tests/lifecycle.integration.test.js`, `api/tests/api.integration.test.js`) —
  run against a real Postgres to prove the atomic claim query, `SKIP LOCKED`
  behavior under concurrency, queue concurrency enforcement, that job
  execution actually writes to `job_executions`/`job_logs`, and the full API
  request/response cycle including retry policies and queue config updates.
  They auto-skip if `TEST_DATABASE_URL` isn't set, so `npm test` never fails
  just because Postgres isn't running.

To run everything including integration tests:

createdb job_scheduler_test
psql job_scheduler_test -f db/migrations/001_init.sql
TEST_DATABASE_URL=postgres://scheduler:scheduler@localhost:5432/job_scheduler_test npm test


## Extending later (bonus features)

- `jobs.depends_on` is already in the schema, unused — enables workflow dependencies.
- Swap the polling worker loop for a `LISTEN/NOTIFY` trigger to reduce latency.
- Add Socket.io to the API server and dashboard for live updates instead of polling.
- Add a `roles` column to `users` + a permission-check middleware for RBAC.
