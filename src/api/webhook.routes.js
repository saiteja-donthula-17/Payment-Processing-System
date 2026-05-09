const express = require('express');
const controller = require('./webhook.controller');
const validate = require('./middlewares/validate.middleware');
const { webhooksLimiter } = require('./middlewares/rateLimit.middleware');
const { webhookCallbackSchema } = require('./schemas');

const router = express.Router();

router.post(
  '/callback',
  webhooksLimiter,
  validate(webhookCallbackSchema),
  controller.handleCallback
);

module.exports = router;
