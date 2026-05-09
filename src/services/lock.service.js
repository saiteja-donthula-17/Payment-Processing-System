const { v4: uuidv4 } = require('uuid');
const redis = require('../redis/client');
const config = require('../config');
const { getLogger } = require('../utils/asyncContext');

const KEY_PREFIX = 'lock:payment:';

// Atomic check-and-delete: only release the lock if we still own it.
// Without this, a stale releaser could delete a NEW holder's lock.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

class LockAcquisitionError extends Error {
  constructor(paymentId) {
    super(`Could not acquire lock for payment ${paymentId}`);
    this.name = 'LockAcquisitionError';
    this.code = 'LOCK_NOT_ACQUIRED';
    this.statusCode = 409;
  }
}

function buildKey(paymentId) {
  return `${KEY_PREFIX}${paymentId}`;
}

async function acquire(paymentId, ttlMs = config.paymentLockTtlMs) {
  const token = uuidv4();
  const result = await redis.set(buildKey(paymentId), token, 'PX', ttlMs, 'NX');
  return result === 'OK' ? token : null;
}

async function release(paymentId, token) {
  return redis.eval(RELEASE_SCRIPT, 1, buildKey(paymentId), token);
}

async function withLock(paymentId, fn, ttlMs = config.paymentLockTtlMs) {
  const log = getLogger();
  const token = await acquire(paymentId, ttlMs);
  if (!token) {
    log.warn({ event: 'lock_not_acquired', payment_id: paymentId }, 'lock not acquired');
    throw new LockAcquisitionError(paymentId);
  }
  log.debug({ event: 'lock_acquired', payment_id: paymentId }, 'lock acquired');
  try {
    return await fn();
  } finally {
    try {
      await release(paymentId, token);
      log.debug({ event: 'lock_released', payment_id: paymentId }, 'lock released');
    } catch (err) {
      log.error(
        { event: 'lock_release_failed', payment_id: paymentId, err: err.message },
        'lock release failed'
      );
    }
  }
}

module.exports = { acquire, release, withLock, LockAcquisitionError };
