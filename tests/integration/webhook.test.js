const request = require('supertest');
const app = require('../../src/app');
const prisma = require('../../src/db/client');
const { truncateAll, disconnect } = require('../helpers/db');
const redis = require('../../src/redis/client');
const { v4: uuid } = require('uuid');

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await disconnect();
  await redis.quit();
});

async function makePayment(status) {
  return prisma.payment.create({
    data: {
      idempotencyKey: `wh-${uuid()}`,
      amount: 100,
      status,
    },
  });
}

describe('POST /webhooks/callback', () => {
  test('missing X-Webhook-Id → 400', async () => {
    const res = await request(app)
      .post('/webhooks/callback')
      .send({ paymentId: 'x', status: 'SUCCESS' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('WEBHOOK_ID_REQUIRED');
  });

  test('invalid status → 422 (zod)', async () => {
    const res = await request(app)
      .post('/webhooks/callback')
      .set('X-Webhook-Id', `wh-${Date.now()}`)
      .send({ paymentId: 'x', status: 'MAYBE' });
    expect(res.status).toBe(422);
  });

  test('PROCESSING → SUCCESS via webhook applies and sets gatewayRef', async () => {
    const p = await makePayment('PROCESSING');
    const res = await request(app)
      .post('/webhooks/callback')
      .set('X-Webhook-Id', `wh-A-${Date.now()}`)
      .send({
        paymentId: p.id,
        status: 'SUCCESS',
        gatewayReference: 'gw-from-wh',
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');

    const after = await prisma.payment.findUnique({ where: { id: p.id } });
    expect(after.status).toBe('SUCCESS');
    expect(after.gatewayReference).toBe('gw-from-wh');
  });

  test('duplicate webhookId → idempotent 200, payload not re-applied', async () => {
    const p = await makePayment('PROCESSING');
    const wid = `wh-dup-${Date.now()}`;

    const r1 = await request(app)
      .post('/webhooks/callback')
      .set('X-Webhook-Id', wid)
      .send({ paymentId: p.id, status: 'SUCCESS' });
    expect(r1.body.status).toBe('processed');

    const r2 = await request(app)
      .post('/webhooks/callback')
      .set('X-Webhook-Id', wid)
      .send({ paymentId: p.id, status: 'FAILED' });
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe('duplicate');

    const after = await prisma.payment.findUnique({ where: { id: p.id } });
    expect(after.status).toBe('SUCCESS');
  });

  test('early callback: PENDING → SUCCESS allowed and tagged was_early', async () => {
    const p = await makePayment('PENDING');
    const res = await request(app)
      .post('/webhooks/callback')
      .set('X-Webhook-Id', `wh-early-${Date.now()}`)
      .send({ paymentId: p.id, status: 'SUCCESS' });
    expect(res.body.wasEarly).toBe(true);
    const after = await prisma.payment.findUnique({ where: { id: p.id } });
    expect(after.status).toBe('SUCCESS');
  });

  test('terminal payment → webhook rejected, state preserved, audit-logged', async () => {
    const p = await makePayment('FAILED');
    const wid = `wh-conflict-${Date.now()}`;
    const res = await request(app)
      .post('/webhooks/callback')
      .set('X-Webhook-Id', wid)
      .send({ paymentId: p.id, status: 'SUCCESS' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('STATE_CONFLICT');

    const after = await prisma.payment.findUnique({ where: { id: p.id } });
    expect(after.status).toBe('FAILED');

    const audit = await prisma.webhookEvent.findUnique({ where: { webhookId: wid } });
    expect(audit.status).toBe('rejected_conflict');
  });

  test('unknown payment → 404', async () => {
    const res = await request(app)
      .post('/webhooks/callback')
      .set('X-Webhook-Id', `wh-404-${Date.now()}`)
      .send({ paymentId: 'no-such', status: 'SUCCESS' });
    expect(res.status).toBe(404);
  });
});
