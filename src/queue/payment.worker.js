const { Worker } = require('bullmq');
const config = require('../config');
const connection = require('./connection');
const paymentService = require('../services/payment.service');
const logger = require('../utils/logger');

function createPaymentWorker() {
  const worker = new Worker(
    config.paymentQueueName,
    async (job) => {
      const { paymentId } = job.data;
      logger.info(
        {
          event: 'queue_job_started',
          job_id: job.id,
          payment_id: paymentId,
          attempt: job.attemptsMade + 1,
        },
        'queue job started'
      );
      const result = await paymentService.processPayment(paymentId);
      return { paymentId: result.id, status: result.status };
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on('completed', (job, returnvalue) => {
    logger.info(
      {
        event: 'queue_job_completed',
        job_id: job.id,
        payment_id: returnvalue?.paymentId,
        status: returnvalue?.status,
      },
      'queue job completed'
    );
  });

  worker.on('failed', (job, err) => {
    const dead = job.attemptsMade >= job.opts.attempts;
    logger[dead ? 'error' : 'warn'](
      {
        event: dead ? 'queue_job_dead_lettered' : 'queue_job_failed',
        job_id: job.id,
        payment_id: job.data?.paymentId,
        attempts_made: job.attemptsMade,
        max_attempts: job.opts.attempts,
        error: err.message,
      },
      dead ? 'job moved to DLQ' : 'job failed, will retry'
    );
  });

  return worker;
}

module.exports = { createPaymentWorker };
