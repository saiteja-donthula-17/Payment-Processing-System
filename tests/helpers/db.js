const prisma = require('../../src/db/client');
const redis = require('../../src/redis/client');

async function truncateAll() {
  await prisma.$transaction([
    prisma.paymentTransition.deleteMany({}),
    prisma.webhookEvent.deleteMany({}),
    prisma.payment.deleteMany({}),
    prisma.idempotencyRecord.deleteMany({}),
  ]);

  const idemKeys = await redis.keys('idem:*');
  if (idemKeys.length) await redis.del(...idemKeys);
  const lockKeys = await redis.keys('lock:payment:*');
  if (lockKeys.length) await redis.del(...lockKeys);
}

async function disconnect() {
  await prisma.$disconnect();
}

module.exports = { truncateAll, disconnect };
