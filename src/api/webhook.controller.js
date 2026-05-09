const prisma = require('../db/client');
const baseLogger = require('../utils/logger');

const TERMINAL = new Set(['SUCCESS', 'FAILED']);
const ACCEPTED_TARGETS = new Set(['SUCCESS', 'FAILED']);

const VALID_FROM_FOR_WEBHOOK = {
  PENDING: ['SUCCESS', 'FAILED'],
  PROCESSING: ['SUCCESS', 'FAILED'],
  SUCCESS: [],
  FAILED: [],
};

async function handleCallback(req, res, next) {
  const log = req.logger || baseLogger;
  try {
    const webhookId = req.headers['x-webhook-id'];
    if (!webhookId) {
      return res.status(400).json({
        error: 'WEBHOOK_ID_REQUIRED',
        message: 'X-Webhook-Id header is required',
      });
    }

    const { paymentId, status: requestedStatus, gatewayReference, eventType } =
      req.body;

    // 1. Duplicate check — at-least-once delivery means same webhookId may arrive multiple times.
    const existing = await prisma.webhookEvent.findUnique({
      where: { webhookId },
    });
    if (existing) {
      log.warn(
        { event: 'webhook_duplicate', webhook_id: webhookId, payment_id: paymentId },
        'duplicate webhook'
      );
      return res.status(200).json({
        status: 'duplicate',
        message: 'webhook already processed',
        webhookId,
      });
    }

    // 2. Fetch payment
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      return res.status(404).json({
        error: 'PAYMENT_NOT_FOUND',
        message: `Payment ${paymentId} not found`,
      });
    }

    // 3. State conflict: payment already terminal
    const allowedTargets = VALID_FROM_FOR_WEBHOOK[payment.status] || [];
    const isConflict = !allowedTargets.includes(requestedStatus);

    if (isConflict) {
      log.warn(
        {
          event: 'webhook_state_conflict',
          webhook_id: webhookId,
          payment_id: paymentId,
          current_status: payment.status,
          requested_status: requestedStatus,
        },
        'webhook conflicts with terminal state'
      );
      // Audit-log the rejection; ack 200 so gateway stops retrying.
      await prisma.webhookEvent.create({
        data: {
          webhookId,
          paymentId,
          eventType: eventType || 'unknown',
          payload: req.body,
          status: 'rejected_conflict',
        },
      });
      return res.status(200).json({
        status: 'rejected',
        reason: 'STATE_CONFLICT',
        message: `Cannot apply ${requestedStatus} to payment in ${payment.status}`,
        currentStatus: payment.status,
      });
    }

    // 4. Apply the transition atomically.
    const isEarly = payment.status === 'PENDING';
    const reason = isEarly ? 'webhook_early_callback' : 'webhook_callback';

    await prisma.$transaction(async (tx) => {
      const update = await tx.payment.updateMany({
        where: { id: paymentId, version: payment.version },
        data: {
          status: requestedStatus,
          version: { increment: 1 },
          ...(gatewayReference && { gatewayReference }),
          processedAt: new Date(),
        },
      });
      if (update.count === 0) {
        // Optimistic lock failed — someone else moved it between our read and write.
        // Re-read and decide: if it landed in our target state, treat as success.
        const fresh = await tx.payment.findUnique({ where: { id: paymentId } });
        if (fresh && fresh.status === requestedStatus) return;
        throw new Error('CONCURRENT_UPDATE');
      }

      await tx.paymentTransition.create({
        data: {
          paymentId,
          fromStatus: payment.status,
          toStatus: requestedStatus,
          reason,
          attempt: payment.retryCount,
        },
      });

      await tx.webhookEvent.create({
        data: {
          webhookId,
          paymentId,
          eventType: eventType || requestedStatus,
          payload: req.body,
          status: 'processed',
        },
      });
    });

    log.info(
      {
        event: 'webhook_applied',
        webhook_id: webhookId,
        payment_id: paymentId,
        from_status: payment.status,
        to_status: requestedStatus,
        was_early: isEarly,
      },
      'webhook applied'
    );

    return res.status(200).json({
      status: 'processed',
      paymentId,
      newStatus: requestedStatus,
      wasEarly: isEarly,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { handleCallback };
