const paymentService = require('../services/payment.service');

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

module.exports = { createPayment, getPayment };
