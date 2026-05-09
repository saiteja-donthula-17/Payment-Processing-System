const express = require('express');
const requestLogger = require('./api/middlewares/requestLogger.middleware');
const paymentRoutes = require('./api/payment.routes');
const webhookRoutes = require('./api/webhook.routes');
const baseLogger = require('./utils/logger');

const app = express();

app.use(express.json());
app.use(requestLogger);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/payments', paymentRoutes);
app.use('/webhooks', webhookRoutes);

app.use((err, req, res, next) => {
  const log = req.logger || baseLogger;

  if (err.code === 'P2002') {
    log.warn(
      {
        event: 'unique_constraint_violation',
        target: err.meta?.target,
      },
      'duplicate'
    );
    return res.status(409).json({
      error: 'DUPLICATE',
      message: `Unique constraint violated: ${(err.meta?.target || []).join(', ')}`,
    });
  }

  if (err.statusCode) {
    log.warn(
      {
        event: 'handled_error',
        error_code: err.code,
        error_name: err.name,
        status: err.statusCode,
      },
      err.message
    );
    return res.status(err.statusCode).json({
      error: err.code || err.name,
      message: err.message,
    });
  }

  log.error({ event: 'unhandled_error', err }, 'unhandled error');
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: err.message || 'Something went wrong',
  });
});

module.exports = app;
