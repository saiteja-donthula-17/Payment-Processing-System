const pino = require('pino');
const config = require('../config');

const isDev = config.nodeEnv !== 'production';

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'payment-gateway' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,service',
        messageFormat: '{msg}',
      },
    },
  }),
});

module.exports = baseLogger;
