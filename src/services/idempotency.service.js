const redis = require('../redis/client');
const config = require('../config');
const { sleep } = require('../utils/sleep');

const KEY_PREFIX = 'idem:';
const IN_PROGRESS_MARKER = '__IN_PROGRESS__';

function buildKey(key) {
  return `${KEY_PREFIX}${key}`;
}

async function acquire(key) {
  const result = await redis.set(
    buildKey(key),
    IN_PROGRESS_MARKER,
    'EX',
    config.idempotencyAcquireTtlSeconds,
    'NX'
  );
  return result === 'OK';
}

async function getResult(key) {
  const value = await redis.get(buildKey(key));
  if (!value) return { state: 'absent' };
  if (value === IN_PROGRESS_MARKER) return { state: 'in_progress' };
  try {
    return { state: 'ready', response: JSON.parse(value) };
  } catch (e) {
    return { state: 'absent' };
  }
}

async function storeResult(key, response) {
  await redis.set(
    buildKey(key),
    JSON.stringify(response),
    'EX',
    config.idempotencyResultTtlSeconds
  );
}

async function release(key) {
  await redis.del(buildKey(key));
}

async function pollForResult(key) {
  const deadline = Date.now() + config.idempotencyPollTimeoutMs;
  while (Date.now() < deadline) {
    const r = await getResult(key);
    if (r.state === 'ready') return r.response;
    if (r.state === 'absent') return null;
    await sleep(config.idempotencyPollIntervalMs);
  }
  return null;
}

module.exports = {
  acquire,
  getResult,
  storeResult,
  release,
  pollForResult,
};
