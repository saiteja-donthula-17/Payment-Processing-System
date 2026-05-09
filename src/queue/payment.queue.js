const { Queue } = require('bullmq');
const config = require('../config');
const connection = require('./connection');

const paymentQueue = new Queue(config.paymentQueueName, {
  connection,
  defaultJobOptions: {
    attempts: config.paymentQueueAttempts,
    backoff: {
      type: 'exponential',
      delay: config.paymentQueueBackoffMs,
    },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: false, // keep failed jobs for DLQ inspection
  },
});

async function enqueueProcessPayment(paymentId, opts = {}) {
  return paymentQueue.add(
    'process-payment',
    { paymentId },
    {
      jobId: `process-${paymentId}`, // dedup at the queue level
      ...opts,
    }
  );
}

async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    paymentQueue.getWaitingCount(),
    paymentQueue.getActiveCount(),
    paymentQueue.getCompletedCount(),
    paymentQueue.getFailedCount(),
    paymentQueue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

async function getDeadLetterJobs(limit = 10) {
  const failedJobs = await paymentQueue.getFailed(0, limit - 1);
  return failedJobs.map((j) => ({
    id: j.id,
    paymentId: j.data?.paymentId,
    attemptsMade: j.attemptsMade,
    failedReason: j.failedReason,
    timestamp: j.timestamp,
  }));
}

module.exports = {
  paymentQueue,
  enqueueProcessPayment,
  getQueueStats,
  getDeadLetterJobs,
};
