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

  maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
  retryBaseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS, 10) || 500,
  retryCapMs: parseInt(process.env.RETRY_CAP_MS, 10) || 10000,
  gatewayTimeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_MS, 10) || 3000,
};
