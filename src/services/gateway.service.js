const { v4: uuidv4 } = require('uuid');
const CircuitBreaker = require('opossum');
const config = require('../config');
const { sleep } = require('../utils/sleep');

class GatewayError extends Error {
  constructor(message, code, retryable) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.retryable = retryable;
  }
}

class GatewayTimeoutError extends GatewayError {
  constructor() {
    super('Gateway timed out', 'GATEWAY_TIMEOUT', true);
    this.name = 'GatewayTimeoutError';
  }
}

const NON_RETRYABLE_CODES = new Set([
  'INVALID_CARD',
  'INSUFFICIENT_FUNDS',
  'DUPLICATE_TRANSACTION',
  'INVALID_AMOUNT',
]);

function isRetryableError(error) {
  if (!error) return true;
  if (error.retryable === false) return false;
  if (error.code && NON_RETRYABLE_CODES.has(error.code)) return false;
  return true;
}

async function _simulate(paymentId, amount) {
  const roll = Math.random();

  if (roll < 0.6) {
    await sleep(50 + Math.random() * 150);
    return {
      success: true,
      gatewayReference: `gw-${uuidv4()}`,
    };
  }

  if (roll < 0.8) {
    await sleep(100 + Math.random() * 400);
    throw new GatewayError('Transient gateway failure', 'GATEWAY_TRANSIENT_ERR', true);
  }

  if (roll < 0.9) {
    await sleep(50 + Math.random() * 150);
    const codes = ['INVALID_CARD', 'INSUFFICIENT_FUNDS'];
    const code = codes[Math.floor(Math.random() * codes.length)];
    throw new GatewayError(`Non-retryable: ${code}`, code, false);
  }

  await sleep(config.gatewayTimeoutMs + 2000);
  return { success: true, gatewayReference: `gw-${uuidv4()}` };
}

async function _processPaymentWithTimeout(paymentId, amount) {
  const gatewayCall = _simulate(paymentId, amount);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new GatewayTimeoutError()), config.gatewayTimeoutMs)
  );
  return Promise.race([gatewayCall, timeoutPromise]);
}

class CircuitOpenError extends GatewayError {
  constructor() {
    super('Gateway circuit breaker is OPEN — failing fast', 'CIRCUIT_OPEN', true);
    this.name = 'CircuitOpenError';
  }
}

const breaker = new CircuitBreaker(_processPaymentWithTimeout, {
  errorThresholdPercentage: config.circuitBreakerErrorThresholdPct,
  resetTimeout: config.circuitBreakerResetTimeoutMs,
  rollingCountTimeout: config.circuitBreakerRollingCountTimeoutMs,
  volumeThreshold: config.circuitBreakerVolumeThreshold,
  // Treat non-retryable user errors (INVALID_CARD etc.) as NOT failures —
  // they don't indicate gateway health.
  errorFilter: (err) => {
    if (err instanceof GatewayError && err.retryable === false) return true;
    return false;
  },
});

breaker.fallback(() => {
  throw new CircuitOpenError();
});

async function processPayment(paymentId, amount) {
  return breaker.fire(paymentId, amount);
}

function getBreakerStats() {
  return {
    state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
    stats: breaker.stats,
  };
}

module.exports = {
  processPayment,
  isRetryableError,
  GatewayError,
  GatewayTimeoutError,
  CircuitOpenError,
  NON_RETRYABLE_CODES,
  getBreakerStats,
  _breaker: breaker, // exposed for tests
};
