// Suppress structured logs during tests; failures still print stack traces.
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
