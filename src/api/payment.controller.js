const paymentService = require('../services/payment.service');
const {
  enqueueProcessPayment,
  getQueueStats,
  getDeadLetterJobs,
} = require('../queue/payment.queue');

async function createPayment(req, res, next) {
  try {
    const { amount, currency, metadata } = req.body;
    const idempotencyKey = req.idempotencyKey;

    const created = await paymentService.createPayment({
      amount,
      currency,
      metadata,
      idempotencyKey,
    });
    await paymentService.processPayment(created.id);
    const full = await paymentService.getPayment(created.id);

    const status = full.status === paymentService.STATUS.SUCCESS ? 201 : 422;
    return res.status(status).json(toResponse(full));
  } catch (error) {
    next(error);
  }
}

async function getPayment(req, res, next) {
  try {
    const payment = await paymentService.getPayment(req.params.id);
    if (!payment) {
      return res.status(404).json({
        error: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    return res.status(200).json(toResponse(payment));
  } catch (error) {
    next(error);
  }
}

function toResponse(payment) {
  return {
    id: payment.id,
    idempotencyKey: payment.idempotencyKey,
    status: payment.status,
    amount: Number(payment.amount),
    currency: payment.currency,
    gatewayReference: payment.gatewayReference,
    retryCount: payment.retryCount,
    maxRetries: payment.maxRetries,
    lastError: payment.lastError,
    metadata: payment.metadata,
    version: payment.version,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    processedAt: payment.processedAt,
    transitions: (payment.transitions || []).map((t) => ({
      from: t.fromStatus,
      to: t.toStatus,
      reason: t.reason,
      attempt: t.attempt,
      at: t.createdAt,
    })),
  };
}

async function createPaymentAsync(req, res, next) {
  try {
    const { amount, currency, metadata } = req.body;
    const idempotencyKey = req.idempotencyKey;

    const created = await paymentService.createPayment({
      amount,
      currency,
      metadata,
      idempotencyKey,
    });

    await enqueueProcessPayment(created.id);

    return res.status(202).json({
      id: created.id,
      status: created.status,
      message:
        'Payment accepted for asynchronous processing. Poll GET /payments/:id for the final status.',
      pollUrl: `/payments/${created.id}`,
    });
  } catch (error) {
    next(error);
  }
}

async function queueStats(req, res, next) {
  try {
    const stats = await getQueueStats();
    const dlq = await getDeadLetterJobs(10);
    return res.json({ stats, deadLetterQueue: dlq });
  } catch (error) {
    next(error);
  }
}

module.exports = { createPayment, getPayment, createPaymentAsync, queueStats };
