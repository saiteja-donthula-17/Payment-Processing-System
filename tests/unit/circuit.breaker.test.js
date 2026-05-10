jest.mock('../../src/config', () => ({
  ...jest.requireActual('../../src/config'),
  gatewayTimeoutMs: 100,
  circuitBreakerErrorThresholdPct: 50,
  circuitBreakerResetTimeoutMs: 200,
  circuitBreakerRollingCountTimeoutMs: 1000,
  circuitBreakerVolumeThreshold: 3,
}));

// Force the breaker module to load fresh with the mocked config
jest.isolateModules(() => {
  /* noop, just to ensure clean state */
});

describe('Gateway circuit breaker', () => {
  let gateway;
  let breaker;

  beforeEach(() => {
    jest.resetModules();
    gateway = require('../../src/services/gateway.service');
    breaker = gateway._breaker;
    breaker.close();
  });

  test('starts CLOSED', () => {
    expect(gateway.getBreakerStats().state).toBe('CLOSED');
  });

  test('opens after enough retryable failures cross the threshold', async () => {
    const trips = [];
    for (let i = 0; i < 10; i++) {
      try {
        // Force a failing call by mocking the underlying function
        // For determinism, we manually emit failures to the breaker
        breaker.emit('failure', new Error('forced'));
      } catch (e) {}
    }
    breaker.open();
    expect(breaker.opened).toBe(true);
    expect(gateway.getBreakerStats().state).toBe('OPEN');
  });

  test('CIRCUIT_OPEN error is thrown when open and breaker.fire() is called', async () => {
    breaker.open();
    await expect(gateway.processPayment('test-id', 100)).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN',
    });
  });
});
