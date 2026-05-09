const prisma = require('../db/client');
const config = require('../config');
const gateway = require('./gateway.service');
const lockService = require('./lock.service');
const { executeWithRetry } = require('./retry.engine');
const { getLogger } = require('../utils/asyncContext');

const STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
};

const VALID_TRANSITIONS = {
  PENDING: ['PROCESSING', 'FAILED'],
  PROCESSING: ['SUCCESS', 'FAILED'],
  SUCCESS: [],
  FAILED: [],
};

class InvalidStateTransitionError extends Error {
  constructor(from, to) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.code = 'INVALID_TRANSITION';
    this.statusCode = 409;
  }
}

class ConcurrentUpdateError extends Error {
  constructor(paymentId) {
    super(`Concurrent update detected on payment ${paymentId}`);
    this.name = 'ConcurrentUpdateError';
    this.code = 'CONCURRENT_UPDATE';
    this.statusCode = 409;
  }
}

class PaymentNotFoundError extends Error {
  constructor(paymentId) {
    super(`Payment ${paymentId} not found`);
    this.name = 'PaymentNotFoundError';
    this.code = 'PAYMENT_NOT_FOUND';
    this.statusCode = 404;
  }
}

function assertValidTransition(from, to) {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

async function createPayment({
  amount,
  currency = 'INR',
  metadata = {},
  idempotencyKey,
}) {
  if (!idempotencyKey) {
    throw new Error('idempotencyKey is required');
  }
  const log = getLogger();
  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        idempotencyKey,
        amount,
        currency,
        metadata,
        maxRetries: config.maxRetries,
      },
    });
    await tx.paymentTransition.create({
      data: {
        paymentId: created.id,
        fromStatus: null,
        toStatus: STATUS.PENDING,
        reason: 'created',
      },
    });
    return created;
  });
  log.info(
    {
      event: 'payment_created',
      payment_id: payment.id,
      amount: Number(payment.amount),
      currency: payment.currency,
    },
    'payment created'
  );
  return payment;
}

async function transitionTo(paymentId, to, opts = {}) {
  const log = getLogger();
  let fromStatus = null;
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new PaymentNotFoundError(paymentId);

    assertValidTransition(payment.status, to);
    fromStatus = payment.status;

    const isTerminal = to === STATUS.SUCCESS || to === STATUS.FAILED;

    const updateRes = await tx.payment.updateMany({
      where: { id: paymentId, version: payment.version },
      data: {
        status: to,
        version: { increment: 1 },
        ...(opts.attempt !== undefined && { retryCount: opts.attempt }),
        ...(opts.lastError !== undefined && { lastError: opts.lastError }),
        ...(opts.gatewayReference !== undefined && {
          gatewayReference: opts.gatewayReference,
        }),
        ...(isTerminal && { processedAt: new Date() }),
      },
    });
    if (updateRes.count === 0) throw new ConcurrentUpdateError(paymentId);

    await tx.paymentTransition.create({
      data: {
        paymentId,
        fromStatus: payment.status,
        toStatus: to,
        reason: opts.reason,
        attempt: opts.attempt ?? 0,
      },
    });

    return tx.payment.findUnique({ where: { id: paymentId } });
  });
  log.info(
    {
      event: 'payment_state_transition',
      payment_id: paymentId,
      from_status: fromStatus,
      to_status: to,
      reason: opts.reason,
      attempt: opts.attempt,
    },
    `state ${fromStatus} -> ${to}`
  );
  return result;
}

async function bumpRetryProgress(paymentId, attempt, lastError) {
  await prisma.payment.updateMany({
    where: { id: paymentId },
    data: {
      retryCount: attempt,
      ...(lastError && { lastError }),
    },
  });
}

async function processPayment(paymentId) {
  const log = getLogger();
  return lockService.withLock(paymentId, async () => {
    await transitionTo(paymentId, STATUS.PROCESSING, {
      reason: 'start_processing',
    });

    try {
      const { result, attempts } = await executeWithRetry(
        paymentId,
        () => gateway.processPayment(paymentId, 0),
        (event) => {
          const errCode = event.error?.code || event.error?.message;
          if (event.status === 'retry_scheduled') {
            log.warn(
              {
                event: 'retry_scheduled',
                payment_id: paymentId,
                attempt: event.attempt,
                delay_ms: event.delay,
                error_code: errCode,
              },
              'retry scheduled'
            );
            bumpRetryProgress(paymentId, event.attempt, errCode).catch((e) =>
              log.error(
                { event: 'retry_progress_bump_failed', err: e.message },
                'bump failed'
              )
            );
          } else if (event.status === 'non_retryable') {
            log.warn(
              {
                event: 'gateway_non_retryable',
                payment_id: paymentId,
                attempt: event.attempt,
                error_code: errCode,
              },
              'non-retryable gateway error'
            );
          } else if (event.status === 'max_retries_exceeded') {
            log.error(
              {
                event: 'max_retries_exceeded',
                payment_id: paymentId,
                attempts: event.attempt,
                error_code: errCode,
              },
              'max retries exceeded'
            );
          }
        }
      );

      log.info(
        {
          event: 'gateway_succeeded',
          payment_id: paymentId,
          attempts,
          gateway_reference: result.gatewayReference,
        },
        'gateway succeeded'
      );

      return await transitionTo(paymentId, STATUS.SUCCESS, {
        reason: 'gateway_success',
        attempt: attempts,
        gatewayReference: result.gatewayReference,
        lastError: null,
      });
    } catch (error) {
      log.error(
        {
          event: 'payment_failed',
          payment_id: paymentId,
          attempts: error.attempts || config.maxRetries + 1,
          error_code: error.code || error.name,
          error_message: error.message,
        },
        'payment permanently failed'
      );

      return await transitionTo(paymentId, STATUS.FAILED, {
        reason: error.code || 'gateway_error',
        attempt: error.attempts || config.maxRetries + 1,
        lastError: error.code || error.message,
      });
    }
  });
}

async function getPayment(paymentId) {
  return prisma.payment.findUnique({
    where: { id: paymentId },
    include: { transitions: { orderBy: { createdAt: 'asc' } } },
  });
}

module.exports = {
  STATUS,
  createPayment,
  processPayment,
  getPayment,
  InvalidStateTransitionError,
  ConcurrentUpdateError,
  PaymentNotFoundError,
};
