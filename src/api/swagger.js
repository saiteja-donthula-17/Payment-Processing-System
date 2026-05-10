const swaggerJsdoc = require('swagger-jsdoc');
const config = require('../config');

const definition = {
  openapi: '3.0.0',
  info: {
    title: 'Payment Processing System',
    version: '1.0.0',
    description:
      'A production-grade payment processing system simulating real-world gateway behavior. ' +
      'Implements idempotency, distributed locks, retry-with-jitter, circuit breaker, async job queue, and webhook handling.',
  },
  servers: [{ url: `http://localhost:${config.port}`, description: 'Local dev' }],
  components: {
    schemas: {
      PaymentStatus: {
        type: 'string',
        enum: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'],
      },
      PaymentTransition: {
        type: 'object',
        properties: {
          from: { $ref: '#/components/schemas/PaymentStatus', nullable: true },
          to: { $ref: '#/components/schemas/PaymentStatus' },
          reason: { type: 'string' },
          attempt: { type: 'integer' },
          at: { type: 'string', format: 'date-time' },
        },
      },
      Payment: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          idempotencyKey: { type: 'string' },
          status: { $ref: '#/components/schemas/PaymentStatus' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          gatewayReference: { type: 'string', nullable: true },
          retryCount: { type: 'integer' },
          maxRetries: { type: 'integer' },
          lastError: { type: 'string', nullable: true },
          metadata: { type: 'object' },
          version: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          processedAt: { type: 'string', format: 'date-time', nullable: true },
          transitions: { type: 'array', items: { $ref: '#/components/schemas/PaymentTransition' } },
        },
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          idempotencyKey: 'order-123-attempt-1',
          status: 'SUCCESS',
          amount: 500,
          currency: 'INR',
          gatewayReference: 'gw-04dff9be-a31c-47f5-93ce-247f2ffdc970',
          retryCount: 1,
          maxRetries: 3,
          lastError: null,
          metadata: { orderId: 'order-456' },
          version: 2,
          createdAt: '2026-05-10T06:58:23.196Z',
          processedAt: '2026-05-10T06:58:23.840Z',
          transitions: [
            { from: null,         to: 'PENDING',    reason: 'created',          attempt: 0, at: '2026-05-10T06:58:23.234Z' },
            { from: 'PENDING',    to: 'PROCESSING', reason: 'start_processing', attempt: 0, at: '2026-05-10T06:58:23.260Z' },
            { from: 'PROCESSING', to: 'SUCCESS',    reason: 'gateway_success',  attempt: 1, at: '2026-05-10T06:58:23.840Z' },
          ],
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
          details: { type: 'array', items: { type: 'object' } },
        },
        example: {
          error: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: [
            { field: 'amount', message: 'Too small: expected number to be >0', code: 'too_small' },
          ],
        },
      },
    },
    parameters: {
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string' },
        description: 'Unique UUID per logical operation. Same key returns the cached response.',
      },
      WebhookId: {
        name: 'X-Webhook-Id',
        in: 'header',
        required: true,
        schema: { type: 'string' },
        description: 'Unique event ID from the gateway. Used to dedup retried webhooks.',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Liveness check',
        responses: { 200: { description: 'OK' } },
      },
    },
    '/payments': {
      post: {
        summary: 'Create and synchronously process a payment',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount'],
                properties: {
                  amount: { type: 'number', minimum: 0.01 },
                  currency: { type: 'string', minLength: 3, maxLength: 3, default: 'INR' },
                  metadata: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Payment processed successfully (SUCCESS)',
            headers: {
              'X-Idempotent-Replay': { schema: { type: 'string' }, description: 'Present and "true" when this is a cached replay of a prior response.' },
              'X-Correlation-Id': { schema: { type: 'string' } },
            },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } },
          },
          400: { description: 'Idempotency-Key header missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          409: { description: 'Idempotency lock contention or DB unique-key collision' },
          422: { description: 'Validation error or terminal payment FAILED' },
          429: { description: 'Rate limit exceeded' },
        },
      },
    },
    '/payments/async': {
      post: {
        summary: 'Create a payment for asynchronous processing (BullMQ queue)',
        description: 'Returns 202 immediately. Poll GET /payments/:id to see when it reaches SUCCESS/FAILED.',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount'],
                properties: {
                  amount: { type: 'number', minimum: 0.01 },
                  currency: { type: 'string', minLength: 3, maxLength: 3 },
                  metadata: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'Accepted for async processing',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    status: { type: 'string' },
                    message: { type: 'string' },
                    pollUrl: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/payments/{id}': {
      get: {
        summary: 'Fetch a payment with its full transition history',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } } },
          404: { description: 'Payment not found' },
        },
      },
    },
    '/payments/queue/stats': {
      get: {
        summary: 'BullMQ queue health + Dead Letter Queue snapshot',
        responses: {
          200: {
            description: 'Queue stats',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    stats: {
                      type: 'object',
                      properties: {
                        waiting: { type: 'integer' },
                        active: { type: 'integer' },
                        completed: { type: 'integer' },
                        failed: { type: 'integer' },
                        delayed: { type: 'integer' },
                      },
                    },
                    deadLetterQueue: { type: 'array' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/webhooks/callback': {
      post: {
        summary: 'Receive an asynchronous status update from the gateway',
        parameters: [{ $ref: '#/components/parameters/WebhookId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['paymentId', 'status'],
                properties: {
                  paymentId: { type: 'string' },
                  status: { type: 'string', enum: ['SUCCESS', 'FAILED'] },
                  gatewayReference: { type: 'string' },
                  eventType: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Processed, duplicate, or rejected (always 2xx so gateway stops retrying)',
          },
          400: { description: 'Missing X-Webhook-Id header' },
          404: { description: 'Payment not found' },
          422: { description: 'Validation error' },
        },
      },
    },
  },
};

const swaggerSpec = swaggerJsdoc({ definition, apis: [] });

module.exports = swaggerSpec;
