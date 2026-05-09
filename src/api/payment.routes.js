const express = require('express');
const controller = require('./payment.controller');
const idempotencyMiddleware = require('./middlewares/idempotency.middleware');
const validate = require('./middlewares/validate.middleware');
const { createPaymentSchema } = require('./schemas');

const router = express.Router();

router.post(
  '/',
  idempotencyMiddleware,
  validate(createPaymentSchema),
  controller.createPayment
);
router.get('/:id', controller.getPayment);

module.exports = router;
