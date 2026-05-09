const config = require('../config');

function calculateBackoffDelay(attempt) {
  const exponential = Math.min(
    config.retryCapMs,
    config.retryBaseDelayMs * Math.pow(2, attempt)
  );
  return Math.floor(Math.random() * exponential);
}

module.exports = { calculateBackoffDelay };
