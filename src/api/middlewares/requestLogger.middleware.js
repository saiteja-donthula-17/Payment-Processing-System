const { v4: uuidv4 } = require('uuid');
const baseLogger = require('../../utils/logger');
const { runWith } = require('../../utils/asyncContext');

function requestLoggerMiddleware(req, res, next) {
  const correlationId =
    req.headers['x-correlation-id'] || `req-${uuidv4().slice(0, 8)}`;
  const logger = baseLogger.child({ correlation_id: correlationId });

  req.correlationId = correlationId;
  req.logger = logger;
  res.setHeader('X-Correlation-Id', correlationId);

  const start = Date.now();
  logger.info(
    {
      event: 'request_started',
      method: req.method,
      path: req.originalUrl,
    },
    'request started'
  );

  res.on('finish', () => {
    logger.info(
      {
        event: 'request_completed',
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration_ms: Date.now() - start,
      },
      'request completed'
    );
  });

  runWith({ correlationId, logger }, () => next());
}

module.exports = requestLoggerMiddleware;
