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

describe('Idempotency', () => {
  test('same key sent twice → second is replay with X-Idempotent-Replay', async () => {
    gateway.processPayment.mockResolvedValue({ success: true, gatewayReference: 'gw-A' });
    const key = `idem-seq-${Date.now()}`;

    const r1 = await request(app)
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 250 });

    const r2 = await request(app)
      .post('/payments')
      .set('Idempotency-Key', key)
      .send({ amount: 250 });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.headers['x-idempotent-replay']).toBe('true');
    expect(r2.body.id).toBe(r1.body.id);
    expect(r2.body.gatewayReference).toBe(r1.body.gatewayReference);
  });

  test('5 concurrent requests with same key → exactly 1 payment created', async () => {
    gateway.processPayment.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { success: true, gatewayReference: 'gw-conc' };
    });
    const key = `idem-conc-${Date.now()}`;

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/payments').set('Idempotency-Key', key).send({ amount: 100 })
      )
    );

    const ids = new Set(responses.map((r) => r.body.id));
    expect(ids.size).toBe(1);

    const replays = responses.filter((r) => r.headers['x-idempotent-replay'] === 'true');
    expect(replays.length).toBe(4);
  });
});
