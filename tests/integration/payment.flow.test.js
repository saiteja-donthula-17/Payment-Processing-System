// Mock the gateway BEFORE requiring the app, so payment.service picks up the mock.
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

describe('POST /payments — happy path', () => {
  test('creates payment, returns SUCCESS, transitions logged', async () => {
    gateway.processPayment.mockResolvedValue({
      success: true,
      gatewayReference: 'gw-mock-ref-123',
    });

    const res = await request(app)
      .post('/payments')
      .set('Idempotency-Key', 'happy-path-001')
      .send({ amount: 500, currency: 'INR' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SUCCESS');
    expect(res.body.gatewayReference).toBe('gw-mock-ref-123');
    expect(res.body.amount).toBe(500);
    expect(res.body.transitions).toHaveLength(3);
    expect(res.body.transitions[0]).toMatchObject({ from: null, to: 'PENDING' });
    expect(res.body.transitions[1]).toMatchObject({ from: 'PENDING', to: 'PROCESSING' });
    expect(res.body.transitions[2]).toMatchObject({ from: 'PROCESSING', to: 'SUCCESS' });
  });

  test('GET /payments/:id returns the payment with full transitions', async () => {
    gateway.processPayment.mockResolvedValue({ success: true, gatewayReference: 'gw-r' });

    const created = await request(app)
      .post('/payments')
      .set('Idempotency-Key', 'get-test-001')
      .send({ amount: 100 });

    const fetched = await request(app).get(`/payments/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(created.body.id);
    expect(fetched.body.transitions).toHaveLength(3);
  });

  test('non-retryable gateway error → FAILED on first attempt', async () => {
    const { GatewayError } = jest.requireActual('../../src/services/gateway.service');
    const err = new GatewayError('invalid card', 'INVALID_CARD', false);
    gateway.processPayment.mockRejectedValue(err);

    const res = await request(app)
      .post('/payments')
      .set('Idempotency-Key', 'invalid-card-001')
      .send({ amount: 100 });

    expect(res.status).toBe(422);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.lastError).toBe('INVALID_CARD');
    expect(res.body.retryCount).toBe(1);
  });
});

describe('POST /payments — input validation', () => {
  test('missing Idempotency-Key → 400', async () => {
    const res = await request(app).post('/payments').send({ amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('amount missing → 422', async () => {
    const res = await request(app)
      .post('/payments')
      .set('Idempotency-Key', `val-${Date.now()}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.details[0].field).toBe('amount');
  });

  test('negative amount → 422', async () => {
    const res = await request(app)
      .post('/payments')
      .set('Idempotency-Key', `val-${Date.now()}`)
      .send({ amount: -100 });
    expect(res.status).toBe(422);
  });
});

describe('GET /payments/:id', () => {
  test('unknown id → 404', async () => {
    const res = await request(app).get('/payments/nonexistent-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PAYMENT_NOT_FOUND');
  });
});
