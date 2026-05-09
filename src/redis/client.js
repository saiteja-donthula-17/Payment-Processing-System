const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('connect', () =>
  logger.info({ event: 'redis_connecting' }, 'redis connecting')
);
redis.on('ready', () =>
  logger.info({ event: 'redis_connected' }, 'redis connected')
);
redis.on('error', (err) =>
  logger.error({ event: 'redis_error', err: err.message }, 'redis error')
);
redis.on('close', () =>
  logger.warn({ event: 'redis_closed' }, 'redis connection closed')
);

module.exports = redis;
