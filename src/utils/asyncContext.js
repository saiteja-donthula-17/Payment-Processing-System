const { AsyncLocalStorage } = require('async_hooks');
const baseLogger = require('./logger');

const storage = new AsyncLocalStorage();

function runWith(context, fn) {
  return storage.run(context, fn);
}

function getStore() {
  return storage.getStore();
}

function getLogger() {
  return getStore()?.logger || baseLogger;
}

function getCorrelationId() {
  return getStore()?.correlationId || null;
}

module.exports = { runWith, getStore, getLogger, getCorrelationId };
