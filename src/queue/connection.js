// BullMQ requires a dedicated ioredis connection with maxRetriesPerRequest = null.
// Reusing src/redis/client.js (which has maxRetriesPerRequest=3) would cause
// runtime errors. So we create a separate connection just for queues.
const Redis = require('ioredis');
const config = require('../config');

const queueConnection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

module.exports = queueConnection;
