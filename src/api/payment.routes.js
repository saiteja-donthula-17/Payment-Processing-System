const express = require('express');
const controller = require('./payment.controller');
const idempotencyMiddleware = require('./middlewares/idempotency.middleware');
const validate = require('./middlewares/validate.middleware');
const { paymentsLimiter, readsLimiter } = require('./middlewares/rateLimit.middleware');
const { createPaymentSchema } = require('./schemas');

const router = express.Router();

router.post(
  '/',
  paymentsLimiter,
  idempotencyMiddleware,
  validate(createPaymentSchema),
  controller.createPayment
);

router.post(
  '/async',
  paymentsLimiter,
  idempotencyMiddleware,
  validate(createPaymentSchema),
  controller.createPaymentAsync
);

router.get('/queue/stats', controller.queueStats);

router.get('/:id', readsLimiter, controller.getPayment);

module.exports = router;
