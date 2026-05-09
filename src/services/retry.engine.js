const config = require('../config');
const { sleep } = require('../utils/sleep');
const { calculateBackoffDelay } = require('../utils/backoff');
const { isRetryableError } = require('./gateway.service');

class MaxRetriesExceededError extends Error {
  constructor(attempts, lastError) {
    super(`Failed after ${attempts} attempts: ${lastError?.message}`);
    this.name = 'MaxRetriesExceededError';
    this.code = 'MAX_RETRIES_EXCEEDED';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

async function executeWithRetry(paymentId, fn, onAttempt) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= config.maxRetries) {
    attempt += 1;
    try {
      if (onAttempt) onAttempt({ attempt, status: 'starting' });
      const result = await fn(attempt);
      if (onAttempt) onAttempt({ attempt, status: 'success' });
      return { result, attempts: attempt };
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        if (onAttempt)
          onAttempt({ attempt, status: 'non_retryable', error });
        error.attempts = attempt;
        throw error;
      }

      if (attempt > config.maxRetries) {
        if (onAttempt)
          onAttempt({ attempt, status: 'max_retries_exceeded', error });
        throw new MaxRetriesExceededError(attempt, error);
      }

      const delay = calculateBackoffDelay(attempt);
      if (onAttempt)
        onAttempt({ attempt, status: 'retry_scheduled', error, delay });
      await sleep(delay);
    }
  }

  throw new MaxRetriesExceededError(attempt, lastError);
}

module.exports = { executeWithRetry, MaxRetriesExceededError };
