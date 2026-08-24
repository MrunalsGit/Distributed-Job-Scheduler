// End-to-end API tests against a real database. See README's "Running tests"
// for how to point TEST_DATABASE_URL at a scratch DB with the migration applied.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const describeIfDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb('API (integration)', () => {
  let app, pool, request;

  beforeAll(() => {
    request = require('supertest');
    ({ app } = require('../src/app'));
    ({ pool } = require('../src/config/db'));
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE jobs, queues, projects, users, retry_policies, scheduled_jobs, dead_letter_queue RESTART IDENTITY CASCADE'
    );
  });

  afterAll(() => pool.end());

  async function signupAndLogin(email = 'test@example.com') {
    await request(app).post('/api/auth/signup').send({ email, password: 'password123' });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
    return res.body.data.token;
  }

  describe('auth', () => {
    test('rejects signup with an invalid email', async () => {
      const res = await request(app).post('/api/auth/signup').send({ email: 'not-an-email', password: 'password123' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('rejects signup with a short password', async () => {
      const res = await request(app).post('/api/auth/signup').send({ email: 'a@b.com', password: '123' });
      expect(res.status).toBe(400);
    });

    test('rejects a duplicate signup with 409', async () => {
      await request(app).post('/api/auth/signup').send({ email: 'dupe@test.com', password: 'password123' });
      const res = await request(app).post('/api/auth/signup').send({ email: 'dupe@test.com', password: 'password123' });
      expect(res.status).toBe(409);
    });

    test('login returns a usable JWT', async () => {
      const token = await signupAndLogin();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    test('login with wrong password is rejected', async () => {
      await signupAndLogin('user2@test.com');
      const res = await request(app).post('/api/auth/login').send({ email: 'user2@test.com', password: 'wrong' });
      expect(res.status).toBe(400);
    });
  });

  describe('projects and queues', () => {
    test('rejects requests without a token', async () => {
      const res = await request(app).get('/api/projects');
      expect(res.status).toBe(401);
    });

    test('creates a project, then a queue under it, end to end', async () => {
      const token = await signupAndLogin();
      const auth = { Authorization: `Bearer ${token}` };

      const projectRes = await request(app).post('/api/projects').set(auth).send({ name: 'My project' });
      expect(projectRes.status).toBe(201);
      const projectId = projectRes.body.data.id;

      const queueRes = await request(app)
        .post(`/api/projects/${projectId}/queues`)
        .set(auth)
        .send({ name: 'emails', concurrencyLimit: 3 });
      expect(queueRes.status).toBe(201);
      expect(queueRes.body.data.concurrency_limit).toBe(3);
    });

    test('pause then resume a queue', async () => {
      const token = await signupAndLogin();
      const auth = { Authorization: `Bearer ${token}` };
      const { body: { data: project } } = await request(app).post('/api/projects').set(auth).send({ name: 'p' });
      const { body: { data: queue } } = await request(app)
        .post(`/api/projects/${project.id}/queues`)
        .set(auth)
        .send({ name: 'q' });

      const paused = await request(app).post(`/api/queues/${queue.id}/pause`).set(auth);
      expect(paused.body.data.is_paused).toBe(true);

      const resumed = await request(app).post(`/api/queues/${queue.id}/resume`).set(auth);
      expect(resumed.body.data.is_paused).toBe(false);
    });
  });

  describe('jobs', () => {
    async function setupQueue() {
      const token = await signupAndLogin();
      const auth = { Authorization: `Bearer ${token}` };
      const { body: { data: project } } = await request(app).post('/api/projects').set(auth).send({ name: 'p' });
      const { body: { data: queue } } = await request(app)
        .post(`/api/projects/${project.id}/queues`)
        .set(auth)
        .send({ name: 'q' });
      return { auth, queueId: queue.id };
    }

    test('submits an immediate job', async () => {
      const { auth, queueId } = await setupQueue();
      const res = await request(app)
        .post(`/api/queues/${queueId}/jobs`)
        .set(auth)
        .send({ type: 'immediate', payload: { handler: 'noop' } });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('queued');
    });

    test('rejects an unknown job type', async () => {
      const { auth, queueId } = await setupQueue();
      const res = await request(app).post(`/api/queues/${queueId}/jobs`).set(auth).send({ type: 'not-a-type' });
      expect(res.status).toBe(400);
    });

    test('a batch job fans out into multiple job rows', async () => {
      const { auth, queueId } = await setupQueue();
      const res = await request(app)
        .post(`/api/queues/${queueId}/jobs`)
        .set(auth)
        .send({ type: 'batch', items: [{ n: 1 }, { n: 2 }, { n: 3 }] });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(3);
    });

    test('rejects a batch job with no items', async () => {
      const { auth, queueId } = await setupQueue();
      const res = await request(app).post(`/api/queues/${queueId}/jobs`).set(auth).send({ type: 'batch', items: [] });
      expect(res.status).toBe(400);
    });

    test('a recurring job without cronExpression is rejected', async () => {
      const { auth, queueId } = await setupQueue();
      const res = await request(app).post(`/api/queues/${queueId}/jobs`).set(auth).send({ type: 'recurring' });
      expect(res.status).toBe(400);
    });

    test('duplicate idempotency key on the same queue is rejected', async () => {
      const { auth, queueId } = await setupQueue();
      const body = { type: 'immediate', payload: {}, idempotencyKey: 'unique-1' };
      const first = await request(app).post(`/api/queues/${queueId}/jobs`).set(auth).send(body);
      expect(first.status).toBe(201);
      const second = await request(app).post(`/api/queues/${queueId}/jobs`).set(auth).send(body);
      expect(second.status).toBe(400);
    });
  });

  describe('retry policies and queue updates', () => {
    test('creates a retry policy and attaches it to a queue via PATCH', async () => {
      const token = await signupAndLogin();
      const auth = { Authorization: `Bearer ${token}` };

      const policyRes = await request(app)
        .post('/api/retry-policies')
        .set(auth)
        .send({ strategy: 'exponential', baseDelayMs: 2000, maxAttempts: 3 });
      expect(policyRes.status).toBe(201);
      expect(policyRes.body.data.strategy).toBe('exponential');

      const { body: { data: project } } = await request(app).post('/api/projects').set(auth).send({ name: 'p' });
      const { body: { data: queue } } = await request(app)
        .post(`/api/projects/${project.id}/queues`)
        .set(auth)
        .send({ name: 'q' });

      const patchRes = await request(app)
        .patch(`/api/queues/${queue.id}`)
        .set(auth)
        .send({ retryPolicyId: policyRes.body.data.id, concurrencyLimit: 9 });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.retry_policy_id).toBe(policyRes.body.data.id);
      expect(patchRes.body.data.concurrency_limit).toBe(9);
    });

    test('rejects an invalid retry policy strategy', async () => {
      const token = await signupAndLogin();
      const auth = { Authorization: `Bearer ${token}` };
      const res = await request(app)
        .post('/api/retry-policies')
        .set(auth)
        .send({ strategy: 'not-a-strategy' });
      expect(res.status).toBe(400);
    });

    test('PATCH with no fields is rejected', async () => {
      const token = await signupAndLogin();
      const auth = { Authorization: `Bearer ${token}` };
      const { body: { data: project } } = await request(app).post('/api/projects').set(auth).send({ name: 'p' });
      const { body: { data: queue } } = await request(app)
        .post(`/api/projects/${project.id}/queues`)
        .set(auth)
        .send({ name: 'q' });

      const res = await request(app).patch(`/api/queues/${queue.id}`).set(auth).send({});
      expect(res.status).toBe(400);
    });
  });

  describe('job detail', () => {
    test('fetching a job includes empty executions and logs arrays before it runs', async () => {
      const token = await signupAndLogin();
      const auth = { Authorization: `Bearer ${token}` };
      const { body: { data: project } } = await request(app).post('/api/projects').set(auth).send({ name: 'p' });
      const { body: { data: queue } } = await request(app)
        .post(`/api/projects/${project.id}/queues`)
        .set(auth)
        .send({ name: 'q' });
      const { body: { data: job } } = await request(app)
        .post(`/api/queues/${queue.id}/jobs`)
        .set(auth)
        .send({ type: 'immediate', payload: {} });

      const res = await request(app).get(`/api/jobs/${job.id}`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.data.executions).toEqual([]);
      expect(res.body.data.logs).toEqual([]);
    });
  });
});
