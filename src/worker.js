const { createPaymentWorker } = require('./queue/payment.worker');
const logger = require('./utils/logger');
const config = require('./config');

const worker = createPaymentWorker();

logger.info(
  {
    event: 'worker_started',
    queue: config.paymentQueueName,
    env: config.nodeEnv,
  },
  'payment worker started — listening for jobs'
);

const shutdown = async (signal) => {
  logger.info({ event: 'worker_shutdown', signal }, 'shutting down worker');
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
