const express = require('express');
const controller = require('./webhook.controller');
const validate = require('./middlewares/validate.middleware');
const { webhookCallbackSchema } = require('./schemas');

const router = express.Router();

router.post('/callback', validate(webhookCallbackSchema), controller.handleCallback);

module.exports = router;
