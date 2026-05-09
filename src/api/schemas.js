const { z } = require('zod');

const createPaymentSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  currency: z.string().length(3).toUpperCase().default('INR'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const webhookCallbackSchema = z.object({
  paymentId: z.string().min(1),
  status: z.enum(['SUCCESS', 'FAILED']),
  gatewayReference: z.string().optional(),
  eventType: z.string().optional(),
});

module.exports = {
  createPaymentSchema,
  webhookCallbackSchema,
};
