require('dotenv').config({ quiet: true });

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  idempotencyAcquireTtlSeconds: 300,
  idempotencyResultTtlSeconds: 86400,
  idempotencyPollIntervalMs: 500,
  idempotencyPollTimeoutMs: 5000,

  // Lock must outlast worst-case processPayment (initial + 3 retries with exp backoff)
  paymentLockTtlMs: 60000,

  // Rate limiting (per-IP)
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  rateLimitPaymentsMax: parseInt(process.env.RATE_LIMIT_PAYMENTS_MAX, 10) || 100,
  rateLimitWebhooksMax: parseInt(process.env.RATE_LIMIT_WEBHOOKS_MAX, 10) || 1000,
  rateLimitReadsMax: parseInt(process.env.RATE_LIMIT_READS_MAX, 10) || 500,

  // Circuit breaker around gateway calls
  circuitBreakerErrorThresholdPct: parseInt(process.env.CB_ERROR_THRESHOLD_PCT, 10) || 50,
  circuitBreakerResetTimeoutMs: parseInt(process.env.CB_RESET_TIMEOUT_MS, 10) || 30000,
  circuitBreakerRollingCountTimeoutMs: 10000,
  circuitBreakerVolumeThreshold: 5,

  // BullMQ queue for async payment processing
  paymentQueueName: 'payment-processing',
  paymentQueueAttempts: parseInt(process.env.QUEUE_ATTEMPTS, 10) || 3,
  paymentQueueBackoffMs: parseInt(process.env.QUEUE_BACKOFF_MS, 10) || 5000,

  maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
  retryBaseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS, 10) || 500,
  retryCapMs: parseInt(process.env.RETRY_CAP_MS, 10) || 10000,
  gatewayTimeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_MS, 10) || 3000,
};
