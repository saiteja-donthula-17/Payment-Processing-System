const { calculateBackoffDelay } = require('../../src/utils/backoff');
const config = require('../../src/config');

describe('calculateBackoffDelay (full jitter)', () => {
  test('returns a non-negative integer', () => {
    for (let i = 1; i <= 10; i++) {
      const d = calculateBackoffDelay(i);
      expect(typeof d).toBe('number');
      expect(d).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(d)).toBe(true);
    }
  });

  test('never exceeds the cap', () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      for (let i = 0; i < 100; i++) {
        const d = calculateBackoffDelay(attempt);
        expect(d).toBeLessThanOrEqual(config.retryCapMs);
      }
    }
  });

  test('respects the exponential ceiling for low attempts', () => {
    const attempt = 1;
    const ceiling = Math.min(
      config.retryCapMs,
      config.retryBaseDelayMs * Math.pow(2, attempt)
    );
    for (let i = 0; i < 200; i++) {
      const d = calculateBackoffDelay(attempt);
      expect(d).toBeLessThanOrEqual(ceiling);
    }
  });

  test('produces variation (jitter is real)', () => {
    const samples = new Set();
    for (let i = 0; i < 100; i++) {
      samples.add(calculateBackoffDelay(3));
    }
    expect(samples.size).toBeGreaterThan(50);
  });
});
