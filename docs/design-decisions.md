# Design decisions

## 1. System overview

The system is three independent Node.js processes sharing one PostgreSQL database:

- **API server** (Express) — auth, project/queue CRUD, job submission, dashboard reads.
- **Scheduler process** — promotes due delayed/cron jobs into real job rows, and
  reaps jobs orphaned by crashed workers.
- **Worker pool** (N processes) — polls queues, atomically claims jobs, executes
  them, handles retries and dead-lettering, sends heartbeats.

See `docs/architecture.png` for the full diagram. Separating these three
processes means a burst of API traffic never delays job scheduling, and
scheduling never competes with job execution for CPU.

## 2. Why Postgres-only, no Redis or Kafka

`SELECT ... FOR UPDATE SKIP LOCKED` gives atomic, duplicate-free job claiming
using the database we already need for everything else. This was a deliberate
choice to keep the system explainable and correct rather than chasing maximum
throughput:

- One fewer moving part to run, configure, and reason about.
- A single source of truth simplifies debugging — job state, logs, and
  execution history all live in one place with real foreign keys.
- **Tradeoff acknowledged**: a Redis-backed queue (or a message broker like
  Kafka/RabbitMQ) would scale claim throughput further at very high job
  volumes, and would enable pub/sub-driven instant dispatch instead of
  polling. At the scale this project targets, that complexity isn't justified.

## 3. Job claiming and concurrency control

The claim query (see `worker/src/jobRepository.js`):

```sql
UPDATE jobs
SET status = 'claimed', worker_id = $2, claimed_at = now(), updated_at = now()
WHERE id IN (
  SELECT id FROM jobs
  WHERE queue_id = $1 AND status = 'queued' AND run_at <= now()
  ORDER BY priority DESC, run_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT GREATEST(0, LEAST(
    $3,
    (SELECT concurrency_limit FROM queues WHERE id = $1)
      - (SELECT COUNT(*) FROM jobs WHERE queue_id = $1 AND status IN ('claimed', 'running'))
  ))
)
RETURNING *
```

`SKIP LOCKED` means two workers racing on the same queue never lock (or
return) the same row — correctness comes from Postgres's own row-locking, not
an external lock manager. This was verified with a real concurrency test
(`worker/tests/claim.integration.test.js`): two simultaneous claims for 6 jobs
each, on a queue with 10 available, return exactly 10 jobs total with zero
overlap.

**Two levels of concurrency limiting exist for different reasons:**
- The queue's `concurrency_limit` protects whatever downstream resource or
  rate limit the queue represents (e.g. "this API partner allows 5 concurrent
  calls").
- The worker's own `MAX_CONCURRENCY` protects the worker process's own
  memory/CPU, independent of any one queue's rules.

**Known tradeoff**: the "active count" subquery inside the claim query is not
itself locked. Under very high concurrency (many worker processes claiming
from the same queue in the same instant), two workers could each see slightly
stale headroom and together overshoot the queue's `concurrency_limit` by a
small amount for one poll cycle. A stricter implementation would take an
advisory lock on the queue row before counting; this project accepts the
small race window as an explicit, documented tradeoff rather than adding that
complexity, since it self-corrects on the next poll.

## 4. Retry strategy

Three backoff strategies, selectable per queue via `retry_policies`:

- **Fixed**: `delay = base_delay_ms` — good for operations where retrying
  immediately isn't harmful (e.g. idempotent internal calls).
- **Linear**: `delay = base_delay_ms * attempt` — moderate backoff.
- **Exponential**: `delay = base_delay_ms * 2^attempt`, capped at 5 minutes —
  the default, and the right choice when the failure might be caused by
  downstream overload (retrying an already-struggling service faster only
  makes things worse).

When `attempt_count` reaches `max_attempts`, the job is moved to
`dead_letter_queue` with a snapshot of its payload, so a human can inspect and
manually requeue it.

## 5. Reliability mechanisms

- **Heartbeats**: each worker inserts a row into `worker_heartbeats` on its
  own interval, decoupled from job execution, so a worker mid-way through a
  slow job still reports as alive.
- **The reaper**: a periodic check (run inside the scheduler process) that
  finds jobs stuck in `claimed`/`running` whose worker has missed several
  heartbeats, and requeues them. Without this, a crashed worker would orphan
  its in-flight jobs permanently.
- **Graceful shutdown**: on SIGTERM, a worker stops claiming new jobs, waits
  up to a grace period for in-flight jobs to finish, and releases any jobs
  still running past that window back to `queued` rather than leaving them
  claimed forever.
- **Idempotency keys**: jobs can carry an `idempotency_key`, enforced with a
  unique index scoped per queue, so duplicate submissions (e.g. a retried
  HTTP request from the client) don't create duplicate jobs.
- **Execution history and logs**: every claim, run, retry, and dead-letter
  event writes a `job_logs` row, and every attempt opens/closes a
  `job_executions` row with timing and error detail. This isn't just for the
  audit trail — it's what the dashboard's job detail page reads directly, so
  a reviewer can see the full attempt-by-attempt history of any job, not just
  its current status. Verified end-to-end with a live worker: a job
  configured to fail once and then succeed produces exactly the expected
  `claimed → started → retried → claimed → started → completed` log sequence
  and two `job_executions` rows (one `failed`, one `completed`).

## 6. Database design tradeoffs

- `retry_policies` is a separate table rather than columns inlined into
  `queues`, so multiple queues can share one policy and a policy can be
  updated in one place.
- **Cascade rules are deliberately split**: `project → queue → job` cascades
  on delete (removing a project should clean up its data), but `job_logs` and
  `job_executions` use `ON DELETE CASCADE` from `jobs` specifically — not
  `RESTRICT` — because they only have meaning in the context of a job that
  still exists; if the job is gone, its logs no longer serve as an audit
  trail for anything reachable. `queues.retry_policy_id` uses
  `ON DELETE SET NULL` instead, since a queue should survive its retry
  policy being deleted (falling back to the worker's default policy) rather
  than being deleted itself.
- **The single most important index**: `jobs (queue_id, status, run_at) WHERE
  status = 'queued'` — a partial index matching exactly what the claim query
  filters and sorts on. This is the index that keeps claiming fast as the
  `jobs` table grows into the millions of rows; without it, every poll would
  require a full table scan.
- Organizations were deliberately **not** modeled as a separate table (users
  own projects directly) to keep the schema explainable; adding an
  `organizations` table between `users` and `projects` is a small, additive
  change if needed later.
- **Organizations were deliberately not modeled as a separate table** — users
  own projects directly instead. The assignment brief names Organizations in
  its list of entities; this is a conscious simplification, not an
  oversight: at the scale of one user managing their own projects, an
  Organizations layer adds a join with no behavioral difference. Adding an
  `organizations` table between `users` and `projects` (with a
  `project.org_id` FK) is a small, additive migration if multi-tenant
  ownership is ever needed.
- **"Scheduled" is a table, not a job status.** The brief describes the job
  lifecycle as `Queued → Scheduled → Claimed → Running → Completed`. In this
  implementation, a delayed/cron/recurring job lives in `scheduled_jobs`
  (with its own `next_run_at`) until the scheduler process promotes it into
  a real row in `jobs` with `status = 'queued'` — so "scheduled" is a
  *holding area* a job passes through before it ever becomes a `jobs` row,
  rather than a value the `jobs.status` column takes. Immediate and batch
  jobs skip this holding area entirely and go straight to `queued`. This
  keeps the claim query's `status` check simple (workers only ever look at
  `queued`/`claimed`/`running`/etc., never a `scheduled` state) at the cost
  of the literal five-state chain not appearing in one column.


## 7. API design choices

- **Job submission is one endpoint with a `type` discriminator**
  (`POST /queues/:id/jobs`) rather than five separate endpoints
  (`/immediate`, `/delayed`, etc.). This keeps the API surface small and
  centralizes validation, at the cost of some branching logic inside a single
  handler. Given how much submission logic is shared (queue lookup,
  idempotency checks), this was judged the better tradeoff.
- **Batch jobs fan out into real rows** at submission time (one row per
  item) rather than being tracked as a single opaque "batch job" — this
  means each sub-job is independently claimed, retried, and can fail without
  blocking or being blocked by its siblings, consistent with how the rest of
  the system treats jobs.
- **Pagination, filtering, and error shape are consistent conventions**
  applied via shared utilities (`utils/pagination.js`, `utils/errors.js`)
  rather than repeated per-route, so every list endpoint and every error
  response looks the same to a client.

## 8. What was deliberately left out, and why

- **No Redis, no Kafka, no distributed lock manager** — correctness comes
  from Postgres `SKIP LOCKED` and standard transactions, which are sufficient
  and far easier to reason about at this scale. See section 2.
- **No microservices split beyond the three processes** — further splitting
  (e.g. a separate metrics service) would add deployment complexity without
  a corresponding correctness or scale benefit here.
- **Structurally ready to add without a rewrite**:
  - `jobs.depends_on` (nullable, self-referencing FK) is in the schema, unused
    — enables workflow dependencies later.
  - The polling worker loop could be swapped for `LISTEN`/`NOTIFY` to reduce
    claim latency without changing the claim query itself.
  - A `roles` column on `users` plus a permission-check middleware would add
    RBAC without touching the data model elsewhere.
  - Socket.io could replace the dashboard's polling for live updates; the API
    responses are already the same shape a push event would carry.

## 9. Known limitations and future work

- **Single-node Postgres is the scaling ceiling.** At very high job volumes,
  the `jobs` table and the claim query's row-locking would become a
  bottleneck. The next step at that scale would be partitioning `jobs` by
  queue or by time, or introducing Redis as a fast claim layer in front of
  Postgres as the durable store.
- **The queue-concurrency race window** described in section 3 is acceptable
  today but would need an advisory lock if strict enforcement became a hard
  requirement.
- **No authentication scoping below "owns the project"** — there's no
  per-queue or per-role permission model yet; RBAC is the natural next
  addition (see section 8).
