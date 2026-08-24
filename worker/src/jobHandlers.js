const handlers = {
  // Baseline handler used by the dashboard "submit test job" button
  'noop': async (payload) => {
    return { ok: true, echoed: payload };
  },

  // Simulates sending an email: validates the payload, sends after a shortdelay and fails if "to" is missing 
  // useful for demoing validation-triggered retries/DLQ without needing a real mail provider
  'send-email': async (payload) => {
    const { to, subject } = payload;
    if (!to) throw new Error('send-email requires a "to" address');
    await sleep(200);
    return { sent: true, to, subject: subject || '(no subject)' };
  },

  // Simulates a report generation job 
  // does some fake "work" proportional to a size parameter, useful for demonstrating concurrency 
  // (several of these running at once, visible in the dashboard's job explorer).
  'generate-report': async (payload) => {
    const rows = payload.rows || 100;
    await sleep(Math.min(rows, 2000)); // capped so demos don't hang
    return { reportRows: rows, generatedAt: new Date().toISOString() };
  },

  // Deliberately fails a configurable number of times before succeeding
  // built specifically to demo retry/backoff behavior live
  'flaky-task': async (payload) => {
    const key = payload.__flakyKey || 'default';
    flakyAttempts[key] = (flakyAttempts[key] || 0) + 1;
    if (flakyAttempts[key] <= (payload.failTimes || 0)) {
      throw new Error(`Simulated failure (attempt ${flakyAttempts[key]})`);
    }
    delete flakyAttempts[key];
    return { succeededAfterAttempts: flakyAttempts[key] };
  },

  // Always fails for demoing the dead letter queue directly without waiting through several real retry cycles
  'always-fail': async () => {
    throw new Error('This handler always fails, by design');
  },
  'slow-task': async (payload) => {
    const ms = payload.ms || 8000;
    await sleep(ms);
    return { sleptMs: ms };
  },

};

// In memory counter for the flaky task demo handler
// Works for my single worker process, would need DB to store counter for a multi woker demo
const flakyAttempts = {};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHandler(job) {
  const handlerName = job.payload?.handler || 'noop';
  const handler = handlers[handlerName];
  if (!handler) {
    throw new Error(`No handler registered for "${handlerName}"`);
  }
  return handler(job.payload);
}

module.exports = { handlers, runHandler };
