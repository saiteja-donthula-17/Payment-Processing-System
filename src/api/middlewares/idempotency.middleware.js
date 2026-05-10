const idempotencyService = require('../../services/idempotency.service');
const baseLogger = require('../../utils/logger');

async function idempotencyMiddleware(req, res, next) {
  const key = req.headers['idempotency-key'];

  if (!key) {
    return res.status(400).json({
      error: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'Idempotency-Key header is required for this endpoint',
    });
  }

  let acquired = false;
  try {
    acquired = await idempotencyService.acquire(key);
  } catch (err) {
    return next(err);
  }

  const log = req.logger || baseLogger;

  if (acquired) {
    req.idempotencyKey = key;
    log.info({ event: 'idempotency_acquired', idempotency_key: key }, 'idempotency lock acquired');

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 500) {
        idempotencyService
          .storeResult(key, { status: res.statusCode, body })
          .catch((e) =>
            log.error({ event: 'idempotency_store_failed', err: e.message }, 'storeResult failed')
          );
      } else {
        idempotencyService
          .release(key)
          .catch((e) =>
            log.error({ event: 'idempotency_release_failed', err: e.message }, 'release failed')
          );
      }
      return originalJson(body);
    };

    return next();
  }

  const r = await idempotencyService.getResult(key);
  if (r.state === 'ready') {
    log.info({ event: 'idempotency_replay', idempotency_key: key }, 'returning cached response');
    res.setHeader('X-Idempotent-Replay', 'true');
    return res.status(r.response.status).json(r.response.body);
  }

  log.info(
    { event: 'idempotency_concurrent_wait', idempotency_key: key },
    'polling for in-progress request'
  );
  const polled = await idempotencyService.pollForResult(key);
  if (polled) {
    log.info(
      { event: 'idempotency_replay_after_poll', idempotency_key: key },
      'returning result from concurrent request'
    );
    res.setHeader('X-Idempotent-Replay', 'true');
    return res.status(polled.status).json(polled.body);
  }

  log.warn({ event: 'idempotency_timeout', idempotency_key: key }, 'concurrent request timeout');
  return res.status(409).json({
    error: 'IDEMPOTENCY_TIMEOUT',
    message:
      'A concurrent request with this Idempotency-Key is still processing. Try again shortly.',
  });
}

module.exports = idempotencyMiddleware;
