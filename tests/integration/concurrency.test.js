/**
 * Validates the system under concurrent load:
 *   1. 10 distinct payments processed in parallel (different idempotency keys)
 *      — proves no DB deadlocks, no lock contention bleeding across IDs.
 *   2. 5 concurrent calls processPayment(sameId) — proves the Redis lock
 *      lets exactly one through; the rest get LockAcquisitionError.
 */

jest.mock('../../src/services/gateway.service', () => {
  const actual = jest.requireActual('../../src/services/gateway.service');
  return {
    ...actual,
    processPayment: jest.fn(),
  };
});

const request = require('supertest');
const app = require('../../src/app');
const gateway = require('../../src/services/gateway.service');
const paymentService = require('../../src/services/payment.service');
const lockService = require('../../src/services/lock.service');
const prisma = require('../../src/db/client');
const { truncateAll, disconnect } = require('../helpers/db');
const redis = require('../../src/redis/client');

beforeEach(async () => {
  await truncateAll();
  gateway.processPayment.mockReset();
});

afterAll(async () => {
  await disconnect();
  await redis.quit();
});

describe('Concurrent throughput — many distinct payments in parallel', () => {
  test('10 different idempotency keys → 10 separate payments, all processed', async () => {
    gateway.processPayment.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { success: true, gatewayReference: `gw-${Math.random()}` };
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post('/payments')
          .set('Idempotency-Key', `parallel-${Date.now()}-${i}`)
          .send({ amount: 100 + i })
      )
    );

    const ids = new Set(responses.map((r) => r.body.id));
    expect(ids.size).toBe(10);

    responses.forEach((r) => {
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('SUCCESS');
    });

    const dbCount = await prisma.payment.count();
    expect(dbCount).toBe(10);

    const transitionCount = await prisma.paymentTransition.count();
    expect(transitionCount).toBe(30);
  });
});

describe('Lock contention — same payment id, parallel processing', () => {
  test('two concurrent processPayment(sameId) → exactly one wins, other throws LockAcquisitionError', async () => {
    gateway.processPayment.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { success: true, gatewayReference: 'gw-lock-test' };
    });

    const created = await paymentService.createPayment({
      amount: 500,
      idempotencyKey: `lock-contention-${Date.now()}`,
    });

    const results = await Promise.allSettled([
      paymentService.processPayment(created.id),
      paymentService.processPayment(created.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(lockService.LockAcquisitionError);

    const transitions = await prisma.paymentTransition.findMany({
      where: { paymentId: created.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(transitions).toHaveLength(3);
    expect(transitions[2].toStatus).toBe('SUCCESS');
  });
});
