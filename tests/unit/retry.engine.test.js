jest.mock('../../src/config', () => ({
  ...jest.requireActual('../../src/config'),
  maxRetries: 3,
  retryBaseDelayMs: 1,
  retryCapMs: 5,
}));

const { executeWithRetry, MaxRetriesExceededError } = require('../../src/services/retry.engine');

class TransientErr extends Error {
  constructor() { super('transient'); this.code = 'GATEWAY_TRANSIENT_ERR'; this.retryable = true; }
}
class HardErr extends Error {
  constructor() { super('hard'); this.code = 'INVALID_CARD'; this.retryable = false; }
}

// The retry engine reads isRetryableError from gateway.service.
// We mock that lookup via the .retryable flag, which gateway.service respects for GatewayError instances.
// To isolate the retry engine from the gateway module, we provide our own GatewayError-like instances
// that the gateway.service's isRetryableError correctly classifies.
jest.mock('../../src/services/gateway.service', () => ({
  isRetryableError: (e) => e.code !== 'INVALID_CARD' && e.code !== 'INSUFFICIENT_FUNDS',
}));

describe('executeWithRetry', () => {
  test('returns immediately on success', async () => {
    const fn = jest.fn().mockResolvedValue({ ok: true });
    const { result, attempts } = await executeWithRetry('p1', fn);
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on transient errors and eventually succeeds', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 3) throw new TransientErr();
      return { ok: true };
    });
    const { attempts } = await executeWithRetry('p2', fn);
    expect(attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws MaxRetriesExceededError after maxRetries+1 attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new TransientErr());
    await expect(executeWithRetry('p3', fn)).rejects.toBeInstanceOf(MaxRetriesExceededError);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  test('non-retryable error fails immediately on first attempt', async () => {
    const fn = jest.fn().mockRejectedValue(new HardErr());
    await expect(executeWithRetry('p4', fn)).rejects.toMatchObject({ code: 'INVALID_CARD' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('attaches attempt count to non-retryable errors', async () => {
    const err = new HardErr();
    const fn = jest.fn().mockRejectedValue(err);
    try {
      await executeWithRetry('p5', fn);
    } catch (e) {
      expect(e.attempts).toBe(1);
    }
  });

  test('calls onAttempt with appropriate event statuses', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls += 1;
      if (calls < 2) throw new TransientErr();
      return { ok: true };
    });
    const events = [];
    await executeWithRetry('p6', fn, (ev) => events.push(ev.status));
    expect(events).toContain('starting');
    expect(events).toContain('retry_scheduled');
    expect(events).toContain('success');
  });
});
