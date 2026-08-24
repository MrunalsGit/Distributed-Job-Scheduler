const { runHandler } = require('../src/jobHandlers');

describe('job handlers', () => {
  test('noop echoes the payload back', async () => {
    const result = await runHandler({ payload: { handler: 'noop', foo: 'bar' } });
    expect(result.ok).toBe(true);
    expect(result.echoed.foo).toBe('bar');
  });

  test('send-email succeeds when "to" is present', async () => {
    const result = await runHandler({ payload: { handler: 'send-email', to: 'a@b.com', subject: 'Hi' } });
    expect(result.sent).toBe(true);
    expect(result.to).toBe('a@b.com');
  });

  test('send-email fails when "to" is missing', async () => {
    await expect(runHandler({ payload: { handler: 'send-email' } })).rejects.toThrow('requires a "to" address');
  });

  test('generate-report returns the requested row count', async () => {
    const result = await runHandler({ payload: { handler: 'generate-report', rows: 50 } });
    expect(result.reportRows).toBe(50);
  });

  test('flaky-task fails the configured number of times then succeeds', async () => {
    const payload = { handler: 'flaky-task', failTimes: 2, __flakyKey: 'test-key-1' };
    await expect(runHandler({ payload })).rejects.toThrow('Simulated failure (attempt 1)');
    await expect(runHandler({ payload })).rejects.toThrow('Simulated failure (attempt 2)');
    const result = await runHandler({ payload });
    expect(result.succeededAfterAttempts).toBeUndefined(); // counter cleared on success
  });

  test('always-fail always throws', async () => {
    await expect(runHandler({ payload: { handler: 'always-fail' } })).rejects.toThrow('always fails');
  });

  test('unknown handler name throws a clear error', async () => {
    await expect(runHandler({ payload: { handler: 'does-not-exist' } })).rejects.toThrow('No handler registered');
  });
});
