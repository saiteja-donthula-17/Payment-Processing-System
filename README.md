# Payment Processing System

> A production-grade payment processing system in **Node.js + Express** that simulates real-world payment-gateway behavior. Every functional, technical, and bonus requirement of the assignment is implemented and covered by automated tests.

**Status:** ✅ All requirements complete · ✅ 31 / 31 tests passing · ✅ All 4 bonus features shipped

---

## 📋 Table of contents

1. [Reviewer's 5-minute verification guide](#-reviewers-5-minute-verification-guide) ← start here
2. [What this system solves](#-what-this-system-solves)
3. [Assignment coverage](#-assignment-coverage)
4. [Tech stack](#-tech-stack)
5. [Architecture at a glance](#-architecture-at-a-glance)
6. [Project structure](#-project-structure)
7. [API reference](#-api-reference)
8. [Key design decisions](#-key-design-decisions)
9. [Concurrency model — 4 layers of defense](#-concurrency-model--4-layers-of-defense)
10. [Observability](#-observability)
11. [How I'd scale this to 10x traffic](#-how-id-scale-this-to-10x-traffic)
12. [Limitations & future work](#-limitations--future-work)
13. [Hands-on testing guide](#-hands-on-testing-guide)

---

## 🚀 Reviewer's 5-minute verification guide

The fastest path from `git clone` to "I can see this is working."

### Prerequisites
- Node.js 20+
- Docker Desktop running

### 1. Clone, install, bring up dependencies (~2 min)

```bash
git clone https://github.com/saiteja-donthula-17/Payment-Processing-System.git
cd Payment-Processing-System
npm install
cp .env.example .env
docker compose up -d                       # starts Postgres 15 + Redis 7
npx prisma migrate dev --name init         # applies DB schema
```

### 2. Run the test suite (~2 sec)

```bash
npm test
```

**Expected output:**
```
Test Suites: 7 passed, 7 total
Tests:       31 passed, 31 total
Time:        ~2s
```

### 3. Start the API + worker (in 2 separate terminals)

```bash
# Terminal A — API server (port 3000)
npm run dev

# Terminal B — BullMQ worker (consumes async-payment jobs)
npm run worker:dev
```

### 4. Demo via Swagger UI (the recommended way)

Open in browser: **http://localhost:3000/api-docs**

This is a live, interactive API explorer. From this single page you can:
- Fire `POST /payments` with a test idempotency key → get a `201` with full transitions
- Fire it AGAIN with the same key → see `X-Idempotent-Replay: true` (no duplicate created)
- Fire `POST /payments/async` → get `202`, then poll `GET /payments/{id}` → watch worker terminal light up
- Inspect the BullMQ queue via `GET /payments/queue/stats`
- Send a webhook via `POST /webhooks/callback` and observe dedup / state-conflict behavior

### 5. Inspect state directly

```bash
# Postgres GUI (recommended)
npx prisma studio                          # opens http://localhost:5555

# Or raw SQL
docker exec payment_db psql -U postgres -d payment_gateway \
  -c "SELECT id, status, \"retryCount\", \"lastError\" FROM \"Payment\" ORDER BY \"createdAt\" DESC LIMIT 10;"

# Redis inspection
docker exec payment_redis redis-cli KEYS 'idem:*'
docker exec payment_redis redis-cli KEYS 'lock:payment:*'
```

For deeper hands-on testing, see [RUNBOOK.md](./RUNBOOK.md).

---

## 🎯 What this system solves

A real payment system has to survive a hostile environment: clients double-click, networks retry, gateways time out, webhooks arrive late or twice or contradict themselves. This project simulates that environment and demonstrates a layered set of techniques that real-world payment systems (Stripe, Razorpay, PayPal) use to stay correct under pressure.

Specifically, the system:

- Accepts payment requests via REST API (`POST /payments`)
- Processes payments through a **simulated external gateway** (random success / transient failure / non-retryable failure / timeout)
- Retries failures with **exponential backoff + full jitter**
- Guarantees no duplicate payments via **idempotency keys** (Redis + DB unique constraint)
- Prevents race conditions via **Redis distributed lock** + **DB optimistic locking**
- Handles **asynchronous webhooks** — duplicates, early callbacks, and conflicting state
- Provides full **structured-JSON observability** with per-request correlation IDs
- Supports **async processing via BullMQ** with a Dead Letter Queue
- Self-protects with a **circuit breaker** when the gateway is unhealthy
- Rate-limits abusive clients with **per-IP throttling**
- Self-documents via a **Swagger / OpenAPI 3.0** spec at `/api-docs`

---

## ✅ Assignment coverage

### Functional requirements (7 / 7)

| # | Requirement | Status | Lives in |
|---|---|---|---|
| 1 | Payment lifecycle (`PENDING → PROCESSING → SUCCESS/FAILED`) | ✅ | `src/services/payment.service.js` |
| 2 | Retry logic (configurable attempts, exponential backoff) | ✅ | `src/services/retry.engine.js` + `src/utils/backoff.js` |
| 3 | Idempotency | ✅ | `src/services/idempotency.service.js` + middleware |
| 4 | Concurrency control | ✅ | `src/services/lock.service.js` + DB `version` |
| 5 | External gateway simulation | ✅ | `src/services/gateway.service.js` |
| 6 | Webhook / callback handling | ✅ | `src/api/webhook.controller.js` |
| 7 | Data consistency | ✅ | Prisma `$transaction` everywhere + `PaymentTransition` audit log |

### Technical expectations (4 / 4)

| # | Requirement | Status |
|---|---|---|
| 1 | Code quality (modular, SoC) | ✅ |
| 2 | Error handling (custom classes, global handler) | ✅ |
| 3 | Logging & observability | ✅ Pino structured JSON + correlation IDs (via `AsyncLocalStorage`) |
| 4 | Testing | ✅ 31 tests across 7 suites (jest + supertest) |

### Bonus features (4 / 4)

| # | Bonus | Status | Lives in |
|---|---|---|---|
| 1 | Queue-based retry handling (BullMQ) | ✅ | `src/queue/` + `POST /payments/async` |
| 2 | Circuit breaker (Opossum) | ✅ | wrapped in `src/services/gateway.service.js` |
| 3 | Rate limiting | ✅ | `src/api/middlewares/rateLimit.middleware.js` |
| 4 | API docs (Swagger / OpenAPI) | ✅ | `/api-docs` + `src/api/swagger.js` |

---

## 🛠 Tech stack

| Tool | Purpose | Why this choice |
|---|---|---|
| **Node.js 20** + **Express 5** | Runtime + HTTP framework | Industry default, minimal middleware composition |
| **PostgreSQL 15** | Primary database | ACID, `DECIMAL(12,2)` for money, FK integrity, what real payment systems use |
| **Prisma 5** | ORM + migrations | Schema-first, type-aware client, declarative migrations |
| **Redis 7** | Idempotency keys, distributed locks, BullMQ backing | Atomic `SET NX EX`, sub-ms latency, single-threaded → naturally atomic |
| **ioredis** | Redis client | Best Node.js client, BullMQ-compatible |
| **BullMQ** | Async job queue + DLQ | Production-grade, Redis-backed, has built-in retries & backoff |
| **Opossum** | Circuit breaker | Battle-tested, simple API, supports `errorFilter` for selective tripping |
| **express-rate-limit** | Per-IP rate limiting | Drop-in middleware, RFC draft-7 headers |
| **Pino** + **pino-pretty** | Structured logger | Fastest Node logger, JSON-native |
| **Zod** | Request validation | Schema-first, detailed error reports |
| **swagger-jsdoc** + **swagger-ui-express** | API docs | Standard for Node.js |
| **Jest** + **Supertest** | Unit + integration tests | Industry default |
| **Docker Compose** | Local Postgres + Redis | Reproducible dev environment, no host pollution |

---

## 🏗 Architecture at a glance

```
                                 ┌──────────────────────────────┐
                                 │     Client (curl / Swagger)  │
                                 └──────────────┬───────────────┘
                                                │ HTTP
                                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              Express app                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌────────────┐      │
│  │ requestLogger│→ │ rateLimit    │→ │ idempotency│→ │ zod        │      │
│  │ correlation  │  │ middleware   │  │ middleware │  │ validate   │      │
│  │ id + pino    │  │              │  │ (Redis NX) │  │            │      │
│  └──────────────┘  └──────────────┘  └────────────┘  └────────────┘      │
│         │                                                  │              │
│         ▼                                                  ▼              │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  controllers — payment / webhook / queueStats                    │    │
│  └──────┬───────────────────────────────────────────────────────────┘    │
│         │                                                                 │
│         ▼                                                                 │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  services/payment.service                                         │    │
│  │   - state machine (VALID_TRANSITIONS map)                         │    │
│  │   - lockService.withLock(  ← Redis distributed lock               │    │
│  │       transitionTo PROCESSING                                     │    │
│  │       executeWithRetry( gateway.processPayment )                  │    │
│  │       transitionTo SUCCESS / FAILED                               │    │
│  │     )                                                              │    │
│  └─────┬─────────────────────────────────────┬────────────────────────┘    │
│        │                                     │                            │
│        │                                     ▼                            │
│        │                           ┌────────────────────┐                 │
│        │                           │  Opossum breaker   │                 │
│        │                           │  wraps gateway call│                 │
│        │                           └─────────┬──────────┘                 │
└────────┼──────────────────────────────────────┼─────────────────────────────┘
         │                                      │
         ├──► PostgreSQL (Payment, PaymentTransition, WebhookEvent)
         ├──► Redis (idem:* keys, lock:payment:* keys, bull:* queues)
         └──► gateway.service (mock external provider)

         ▲
         │   async path
┌────────┼─────────────────────────────────────────────────────────────────┐
│  POST /payments/async  →  enqueueProcessPayment(jobId)                    │
│                                    │                                       │
│                                    ▼                                       │
│                          ┌──────────────────┐                             │
│                          │  BullMQ worker   │  ← npm run worker            │
│                          │  picks job, runs │                             │
│                          │  paymentService  │                             │
│                          │  .processPayment │                             │
│                          └──────────────────┘                             │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project structure

```
payment-gateway/
├── docker-compose.yml          # Postgres 15 + Redis 7
├── package.json
├── jest.config.js
├── prisma/
│   ├── schema.prisma           # 4 models: Payment, PaymentTransition, WebhookEvent, IdempotencyRecord
│   └── migrations/
├── src/
│   ├── api/
│   │   ├── middlewares/
│   │   │   ├── idempotency.middleware.js     # Redis-backed idempotency
│   │   │   ├── rateLimit.middleware.js       # per-IP throttling
│   │   │   ├── requestLogger.middleware.js   # correlation IDs + pino
│   │   │   └── validate.middleware.js        # zod schema validator
│   │   ├── payment.controller.js
│   │   ├── payment.routes.js
│   │   ├── webhook.controller.js
│   │   ├── webhook.routes.js
│   │   ├── schemas.js          # zod schemas for all request bodies
│   │   └── swagger.js          # OpenAPI 3.0 spec
│   ├── services/
│   │   ├── gateway.service.js  # mock external gateway + Opossum breaker
│   │   ├── idempotency.service.js
│   │   ├── lock.service.js     # Redis distributed lock with token-fenced Lua release
│   │   ├── payment.service.js  # state machine + processPayment
│   │   └── retry.engine.js     # backoff + retry loop
│   ├── queue/
│   │   ├── connection.js       # dedicated Redis connection for BullMQ
│   │   ├── payment.queue.js    # queue + enqueue helper + DLQ inspection
│   │   └── payment.worker.js   # worker that consumes jobs
│   ├── db/client.js            # Prisma singleton
│   ├── redis/client.js         # ioredis singleton
│   ├── utils/
│   │   ├── backoff.js
│   │   ├── sleep.js
│   │   ├── logger.js           # pino base logger
│   │   └── asyncContext.js     # AsyncLocalStorage for correlation ID
│   ├── config.js               # env-driven config
│   ├── app.js
│   ├── index.js                # API server bootstrap
│   └── worker.js               # BullMQ worker bootstrap
└── tests/
    ├── unit/
    │   ├── backoff.test.js
    │   ├── retry.engine.test.js
    │   └── circuit.breaker.test.js
    └── integration/
        ├── payment.flow.test.js
        ├── idempotency.test.js
        ├── concurrency.test.js
        └── webhook.test.js
```

---

## 📖 API reference

> Live, interactive version available at **http://localhost:3000/api-docs** when the server is running.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/payments` | **Sync**: create + process payment (returns 201/422 with final state) |
| `POST` | `/payments/async` | **Async**: enqueue for worker processing (returns 202 immediately) |
| `GET` | `/payments/:id` | Fetch a payment with full transition history |
| `GET` | `/payments/queue/stats` | BullMQ queue health + Dead Letter Queue snapshot |
| `POST` | `/webhooks/callback` | Receive async status update from the gateway |
| `GET` | `/api-docs` | Swagger UI |
| `GET` | `/api-docs.json` | Raw OpenAPI 3.0 spec |

### `POST /payments` example

**Request**
```http
POST /payments
Content-Type: application/json
Idempotency-Key: 7c9d8e2f-4b1a-4c8d-9f2e-1a5b6c7d8e9f

{
  "amount": 500.00,
  "currency": "INR",
  "metadata": { "orderId": "order-123" }
}
```

**Response — 201 Created (success path)**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "idempotencyKey": "7c9d8e2f-...",
  "status": "SUCCESS",
  "amount": 500,
  "currency": "INR",
  "gatewayReference": "gw-04dff9be-...",
  "retryCount": 1,
  "maxRetries": 3,
  "lastError": null,
  "metadata": { "orderId": "order-123" },
  "version": 2,
  "createdAt": "2026-05-10T...",
  "processedAt": "2026-05-10T...",
  "transitions": [
    { "from": null,         "to": "PENDING",    "reason": "created",          "attempt": 0 },
    { "from": "PENDING",    "to": "PROCESSING", "reason": "start_processing", "attempt": 0 },
    { "from": "PROCESSING", "to": "SUCCESS",    "reason": "gateway_success",  "attempt": 1 }
  ]
}
```

**Headers on idempotent replay** include `X-Idempotent-Replay: true`.

| Status | Meaning |
|---|---|
| `201` | Payment processed successfully |
| `202` | (async path) Accepted for queue processing |
| `400` | Missing required header (`Idempotency-Key` or `X-Webhook-Id`) |
| `404` | Payment not found |
| `409` | Idempotency conflict / unique constraint violation / lock contention |
| `422` | Validation error or payment ended in `FAILED` state |
| `429` | Rate limit exceeded |

---

## 🧠 Key design decisions

| Decision | Why |
|---|---|
| **Postgres, not MongoDB** | ACID transactions, `DECIMAL(12,2)` for exact money math, FK integrity, what real payment systems use. NoSQL doesn't give you `SELECT FOR UPDATE` semantics or single-statement multi-row atomicity easily. |
| **Idempotency at the edge** (middleware) | Redis sub-ms lookup avoids hitting the DB for replays. The DB unique constraint on `idempotencyKey` is the safety net in case Redis is wiped. |
| **Full jitter** in backoff | Prevents synchronized thundering-herd retries. AWS Architecture Blog formula: `delay = random(0, min(cap, base * 2^attempt))`. |
| **Custom error classes** with `statusCode` | Global error handler maps cleanly. `isRetryableError` checks `error.retryable === false` directly (more robust than `instanceof` across module boundaries). |
| **Audit log table** (`PaymentTransition`) | Every state change writes a row inside the same transaction. Recreates full history of any payment for forensics. |
| **Optimistic locking** (`version` column + `updateMany`) | Cheap, doesn't hold DB row locks during external gateway calls. Detects concurrent updates at write time. |
| **Webhook returns 200 even on conflict** | `4xx` would trigger gateway retries forever; we ack and audit-log the rejection internally. Stripe / Razorpay both recommend this pattern. |
| **`AsyncLocalStorage` for correlation IDs** | No prop-drilling. Every nested service automatically gets the request's logger ambient. |
| **Circuit breaker `errorFilter` excludes user errors** | A wave of bad cards (`INVALID_CARD`, `INSUFFICIENT_FUNDS`) shouldn't trip the breaker — the gateway is healthy, it's responding correctly to bad input. Only gateway/network failures count. |
| **Sync AND async endpoints** | `POST /payments` (sync) is the simple primary path. `POST /payments/async` adds queue-based processing for high-throughput scenarios without breaking the synchronous flow. |

---

## 🛡 Concurrency model — 4 layers of defense

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Idempotency middleware (Redis SET NX EX)                         │
│   → Prevents duplicate REQUESTS from creating duplicate payments          │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Distributed lock (Redis SET NX PX with token-fenced release)     │
│   → Prevents two processes from PROCESSING the same payment concurrently  │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Optimistic locking (DB version field, updateMany WHERE version)  │
│   → Detects stale writes if Redis fails or lock expires mid-work          │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ Layer 4: State machine guards (VALID_TRANSITIONS map)                     │
│   → Rejects illegal transitions even if all the above somehow fail        │
└──────────────────────────────────────────────────────────────────────────┘
```

Each layer has a different cost / scope. Layer 1 is the cheapest (most replays don't even hit the DB). Layer 4 is the last-resort guard.

---

## 🔭 Observability

Every log line is JSON (or pretty-colorized in dev) and includes:

- `timestamp` — ISO 8601
- `correlation_id` — UUID per request, attached to **every** log line for that request
- `service` — `"payment-gateway"`
- `event` — stable event name (`payment_state_transition`, `retry_scheduled`, `webhook_applied`, `queue_job_started`, `circuit_open`, …)
- Plus event-specific fields: `payment_id`, `attempt`, `delay_ms`, `error_code`, etc.

To trace one request's full journey:
- The response includes header `X-Correlation-Id: req-7f2a8c1d`
- Filter your logs by that ID — you see the whole lifecycle in chronological order, isolated from concurrent traffic

In production, `NODE_ENV=production` produces raw JSON ready for Datadog / Loki / CloudWatch.

---

## 📈 How I'd scale this to 10x traffic

The current design is **horizontally scalable on day one** — most of the work is already done. Here's the deployment story for going from 1 instance handling ~100 req/min to a fleet handling 10,000 req/min.

### What's already scale-ready

- **Stateless API process** — no in-memory state. Run N replicas behind a load balancer (e.g. an ALB).
- **Stateless worker process** — same. Spin up M worker replicas; BullMQ handles fair distribution.
- **Shared Redis** for idempotency, locks, and queue — already cross-instance.
- **DB version-based optimistic locking** — works correctly across distributed writers without coordination.
- **Correlation IDs propagated** — log aggregator (Datadog) ties traces across instances seamlessly.

### What I'd add when scaling out

| Concern | Today | At 10× scale |
|---|---|---|
| **Postgres read load** | Single instance | Add 1-2 read replicas; route `GET /payments/:id` reads there. Writes stay on primary. |
| **Postgres write load** | Single instance | Vertically scale primary. If still tight: shard by `payment.id` prefix or move audit log (`PaymentTransition`) to a separate DB / OLAP store. |
| **Connection pool** | Default Prisma settings | Tune `connection_limit` based on `(replicas × concurrency)` vs PG `max_connections`. PgBouncer in transaction mode if approaching limits. |
| **Redis** | Single node | Redis cluster (3-shard, 1 replica each) or AWS ElastiCache. Keys are already prefixed (`idem:`, `lock:`, `bull:`) so resharding is straightforward. |
| **Rate limiter** | In-memory (per-process) | `rate-limit-redis` store so all instances share counters. |
| **BullMQ workers** | 1 process, concurrency 5 | Many processes × concurrency 10-20 each. BullMQ handles distribution + visibility timeouts. |
| **Idempotency cache locality** | Single Redis | Same Redis cluster — keys are independent. |
| **Dead Letter Queue** | In-memory inspection via `GET /queue/stats` | Alarm + Slack alert when DLQ size > N. Scheduled retry job for transient-looking failures. |

### Things I'd watch in production

1. **Per-payment retry budget vs. queue retry budget.** The inline `executeWithRetry` (3 retries) compounds with BullMQ's `attempts: 3`. Total = up to 9 gateway calls per payment if everything retries. Tune one or the other.
2. **Lock TTL vs. work duration.** With slow gateways and full backoff, a single payment can take 30+ seconds. Lock TTL is 60s — enough margin, but worth a metric.
3. **Circuit breaker per-process state.** Each Node instance has its own breaker. With 10 instances, the gateway might trip 4 of them and not the others. Could be moved to a Redis-backed shared state, but per-instance is usually fine and cheaper.
4. **Idempotency cache size.** 24-hour TTL × 10K payments/min = ~14M keys at peak. Redis can handle this easily but the TTL window is a tunable.

### Failure mode budget

Even with all the above, here's what we'd still need to handle:
- **Postgres failover** — Prisma reconnects; in-flight transactions abort and roll back. Idempotency middleware lets clients safely retry.
- **Redis failover** — DB unique constraint on `idempotencyKey` is the backstop; concurrency briefly relies on DB-level optimistic locking until Redis is back.
- **Gateway hard outage** — circuit breaker trips, payments enter `FAILED` immediately with `CIRCUIT_OPEN`. Manual replay via the DLQ (or a "retry failed" admin endpoint, easy to add) once the gateway recovers.

---

## ⚠️ Limitations & future work

Honest about what's not here:

- **Webhook signature verification** — production gateways send `Stripe-Signature` (HMAC-SHA256). Easy to add — read the secret from env, verify in middleware before parsing the body.
- **Body-hash idempotency conflicts** — currently the same key with different body would replay the cached response. The right behavior is to hash the body and reject mismatches with `409 IDEMPOTENCY_CONFLICT`. Stripe does this.
- **Test database isolation** — integration tests truncate the dev DB between runs. In CI you'd point at a separate `payment_gateway_test` database.
- **Auth/AuthZ** — there's no client identity. In production every endpoint would require an API key with scoped permissions; webhooks would verify by signature, not just header presence.
- **Metrics endpoint** — Prometheus `/metrics` exposing histogram of gateway latency, retry distribution, circuit breaker state, queue depth.
- **Manual retry endpoint for DLQ** — the DLQ is inspectable but there's no `POST /admin/retry/:jobId` to push a failed job back. Would add for ops.
- **Distributed tracing** — correlation IDs are good for single-service traces. For multi-service you'd add OpenTelemetry spans.

---

## 📚 Hands-on testing guide

For step-by-step manual testing of every scenario (happy path, network blip, concurrent dupes, webhook conflicts, etc.), see **[RUNBOOK.md](./RUNBOOK.md)**.

## License

MIT

---

*Built for the Mid-Level Backend Developer (Node.js) take-home assignment. Architecture references real production patterns from Stripe, Razorpay, AWS Architecture Blog, and PayPal engineering writeups.*
