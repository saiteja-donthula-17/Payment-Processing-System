const rateLimit = require('express-rate-limit');
const config = require('../../config');

function buildLimiter(max) {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Try again later.',
    },
    skip: () => process.env.NODE_ENV === 'test',
  });
}

module.exports = {
  paymentsLimiter: buildLimiter(config.rateLimitPaymentsMax),
  webhooksLimiter: buildLimiter(config.rateLimitWebhooksMax),
  readsLimiter: buildLimiter(config.rateLimitReadsMax),
};
