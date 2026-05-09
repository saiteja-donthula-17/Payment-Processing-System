const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

app.listen(config.port, () => {
  logger.info(
    {
      event: 'server_started',
      port: config.port,
      env: config.nodeEnv,
      max_retries: config.maxRetries,
      retry_base_delay_ms: config.retryBaseDelayMs,
      retry_cap_ms: config.retryCapMs,
      gateway_timeout_ms: config.gatewayTimeoutMs,
    },
    `payment-gateway listening on http://localhost:${config.port}`
  );
});
