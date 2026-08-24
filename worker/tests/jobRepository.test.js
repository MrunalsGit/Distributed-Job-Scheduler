const { computeBackoff } = require('../src/jobRepository');

describe('computeBackoff', () => {
  test('fixed strategy always returns the base delay', () => {
    const policy = { strategy: 'fixed', base_delay_ms: 1000 };
    expect(computeBackoff(policy, 1)).toBe(1000);
    expect(computeBackoff(policy, 5)).toBe(1000);
  });

  test('linear strategy scales with attempt number', () => {
    const policy = { strategy: 'linear', base_delay_ms: 1000 };
    expect(computeBackoff(policy, 1)).toBe(1000);
    expect(computeBackoff(policy, 3)).toBe(3000);
  });

  test('exponential strategy doubles per attempt and caps at 5 minutes', () => {
    const policy = { strategy: 'exponential', base_delay_ms: 1000 };
    expect(computeBackoff(policy, 1)).toBe(2000);
    expect(computeBackoff(policy, 2)).toBe(4000);
    expect(computeBackoff(policy, 20)).toBe(5 * 60 * 1000); // capped
  });
});
