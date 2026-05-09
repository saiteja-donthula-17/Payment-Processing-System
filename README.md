# Payment Processing System

A production-grade payment processing system in **Node.js + Express** that simulates real-world payment-gateway behavior. Every functional and technical requirement of the assignment is implemented and covered by automated tests.

> **Status:** Core (Phases 1–2) complete. Bonus features (Phase 3) optional.

---

## Table of contents

1. [What this system does](#1-what-this-system-does)
2. [Assignment coverage](#2-assignment-coverage)
3. [Tech stack](#3-tech-stack)
4. [Architecture at a glance](#4-architecture-at-a-glance)
5. [Project structure](#5-project-structure)
6. [Setup](#6-setup)
7. [Running the server](#7-running-the-server)
8. [Running tests](#8-running-tests)
9. [API reference](#9-api-reference)
10. [Key design decisions](#10-key-design-decisions)
11. [Concurrency model — 4 layers of defense](#11-concurrency-model--4-layers-of-defense)
12. [Observability](#12-observability)
13. [Limitations & future work](#13-limitations--future-work)
14. [Hands-on testing guide](#14-hands-on-testing-guide)

---

## 1. What this system does

- Accepts payment requests via REST API (`POST /payments`)
- Processes payments through a **simulated external gateway** (random success / transient failure / non-retryable failure / timeout)
- Retries failures with **exponential backoff + full jitter**
- Guarantees no duplicate payments via **idempotency keys** (Redis + DB unique constraint)
- Prevents race conditions via **Redis distributed lock** + **DB optimistic locking**
- Handles **asynchronous webhooks** — duplicates, early callbacks, and conflicting state
- Provides full **structured-JSON observability** with per-request correlation IDs

---

## 2. Assignment coverage

### Functional requirements

| # | Requirement | Status | Lives in |
|---|---|---|---|
| 1 | Payment lifecycle (`PENDING → PROCESSING → SUCCESS/FAILED`) | ✅ | `src/services/payment.service.js` |
| 2 | Retry logic (configurable attempts, exponential backoff) | ✅ | `src/services/retry.engine.js` + `src/utils/backoff.js` |
| 3 | Idempotency | ✅ | `src/services/idempotency.service.js` + middleware |
| 4 | Concurrency control | ✅ | `src/services/lock.service.js` + DB `version` |
| 5 | External gateway simulation | ✅ | `src/services/gateway.service.js` |
| 6 | Webhook / callback handling | ✅ | `src/api/webhook.controller.js` |
| 7 | Data consistency | ✅ | Prisma `$transaction` everywhere + `PaymentTransition` audit log |

### Technical expectations

| # | Requirement | Status |
|---|---|---|
| 1 | Code quality (modular, SoC) | ✅ |
| 2 | Error handling (custom classes, global handler) | ✅ |
| 3 | Logging & observability | ✅ Pino structured JSON + correlation IDs |
| 4 | Testing | ✅ 26 tests (jest + supertest) |

### Bonus (optional) — ALL DONE

| # | Requirement | Status | Lives in |
|---|---|---|---|
| 1 | Queue-based retry (BullMQ) | ✅ | `src/queue/` + `POST /payments/async` |
| 2 | Circuit breaker (Opossum) | ✅ | wrapped in `src/services/gateway.service.js` |
| 3 | Rate limiting | ✅ | `src/api/middlewares/rateLimit.middleware.js` |
| 4 | API docs (Swagger / OpenAPI) | ✅ | `/api-docs` + `src/api/swagger.js` |

---

## 3. Tech stack

| Tool | Purpose | Why |
|---|---|---|
| **Node.js** + **Express 5** | Runtime + HTTP framework | Industry default, minimal middleware composition |
| **PostgreSQL 15** | Primary database | ACID transactions, `SELECT FOR UPDATE`, `DECIMAL` for money, FK integrity |
| **Prisma 5** | ORM + migrations | Type-aware queries, declarative schema, painless migrations |
| **Redis 7** | Idempotency keys, distributed locks | Atomic `SET NX EX`, sub-ms latency, single-threaded → naturally atomic |
| **ioredis** | Redis client | Best Node.js client, also used by BullMQ |
| **Pino** | Structured logger | Fastest Node logger, JSON-native, child loggers |
| **Zod** | Request validation | Schema-first, detailed error reports |
| **Jest** + **Supertest** | Unit + integration tests | Industry default |
| **Docker Compose** | Local Postgres + Redis | Reproducible dev environment, no host pollution |

---

## 4. Architecture at a glance

```
                                 ┌──────────────────────────────┐
                                 │     Client (your curl/UI)    │
                                 └──────────────┬───────────────┘
                                                │ HTTP
                                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              Express app                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌────────────┐      │
│  │ requestLogger│→│ idempotency   │→│ zod        │→│ controller │      │
│  │ correlation  │  │ middleware    │  │ validate   │  │            │      │
│  │ id + pino    │  │ (Redis NX)    │  │ schemas.js │  │            │      │
│  └──────────────┘  └──────────────┘  └────────────┘  └─────┬──────┘      │
│                                                             │             │
│                                                             ▼             │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                      services/payment.service                       │  │
│  │   - state machine + transitions                                     │  │
│  │   - lockService.withLock(  ← Redis distributed lock                 │  │
│  │       transitionTo PROCESSING                                       │  │
│  │       executeWithRetry( gateway.processPayment )                    │  │
│  │       transitionTo SUCCESS/FAILED                                   │  │
│  │     )                                                                │  │
│  └─────┬──────────────────────────────────────────────────────────────┘  │
│        │                                                                  │
└────────┼──────────────────────────────────────────────────────────────────┘
         │
         ├──────► PostgreSQL (Payment, PaymentTransition, WebhookEvent)
         ├──────► Redis (idem:* keys, lock:payment:* keys)
         └──────► gateway.service (mock external provider)
```

---

## 5. Project structure

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
│   │   │   ├── idempotency.middleware.js
│   │   │   ├── requestLogger.middleware.js
│   │   │   └── validate.middleware.js
│   │   ├── payment.controller.js
│   │   ├── payment.routes.js
│   │   ├── webhook.controller.js
│   │   ├── webhook.routes.js
│   │   └── schemas.js          # zod schemas for all request bodies
│   ├── services/
│   │   ├── gateway.service.js  # mock external gateway
│   │   ├── idempotency.service.js
│   │   ├── lock.service.js     # Redis distributed lock
│   │   ├── payment.service.js  # state machine + processPayment
│   │   └── retry.engine.js     # backoff + retry loop
│   ├── db/client.js            # Prisma singleton
│   ├── redis/client.js         # ioredis singleton
│   ├── utils/
│   │   ├── backoff.js
│   │   ├── sleep.js
│   │   ├── logger.js           # pino base logger
│   │   └── asyncContext.js     # AsyncLocalStorage for correlation ID
│   ├── config.js               # env-driven config
│   ├── app.js
│   └── index.js
└── tests/
    ├── unit/
    │   ├── backoff.test.js
    │   └── retry.engine.test.js
    └── integration/
        ├── payment.flow.test.js
        ├── idempotency.test.js
        └── webhook.test.js
```

---

## 6. Setup

### Prerequisites
- Node.js 20+
- Docker Desktop (for Postgres and Redis)

### One-time setup
```bash
git clone <this-repo>
cd "Payment Processing System"

# 1. Install dependencies
npm install

# 2. Copy env template (defaults work for local dev)
cp .env.example .env

# 3. Bring up Postgres + Redis via Docker
docker compose up -d

# 4. Apply DB schema
npx prisma migrate dev
```

---

## 7. Running the server

```bash
npm run dev          # API server with auto-restart (port 3000)
npm run worker:dev   # async-payments worker (separate terminal)
npm start            # plain node (production-style)
NODE_ENV=production npm start   # JSON logs instead of pretty colorized
```

The server listens on `http://localhost:3000`.

- Health check: `curl http://localhost:3000/health` → `{"status":"ok"}`
- **Interactive API docs: open `http://localhost:3000/api-docs` in your browser.**

---

## 8. Running tests

```bash
npm test                 # all tests (5 suites, 26 tests, ~1.5s)
npm run test:unit        # unit only (no DB / Redis required)
npm run test:integration # integration (needs docker compose up first)
```

Latest run: **26 / 26 passing.**

---

## 9. API reference

> Interactive version available at `http://localhost:3000/api-docs` once the server is running.

### `POST /payments`

Create and process a payment.

**Headers**
- `Idempotency-Key: <unique-uuid>` (required) — prevents duplicate payments on client retries
- `Content-Type: application/json`

**Body**
```json
{
  "amount": 500.00,
  "currency": "INR",
  "metadata": { "orderId": "order-123" }
}
```

**Responses**

| Status | Meaning |
|---|---|
| `201 Created` | Payment processed successfully (`status: SUCCESS`) |
| `422 Unprocessable Entity` | Validation error or `status: FAILED` (terminal failure) |
| `400 Bad Request` | Missing `Idempotency-Key` header |
| `409 Conflict` | Idempotency lock contention OR DB unique-key collision |

If the request is a replay of a previously cached idempotent response, you'll see `X-Idempotent-Replay: true`.

**Sample 201 response**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "idempotencyKey": "abc-123",
  "status": "SUCCESS",
  "amount": 500,
  "currency": "INR",
  "gatewayReference": "gw-...",
  "retryCount": 1,
  "maxRetries": 3,
  "lastError": null,
  "metadata": { "orderId": "order-123" },
  "version": 2,
  "createdAt": "...",
  "updatedAt": "...",
  "processedAt": "...",
  "transitions": [
    { "from": null,         "to": "PENDING",    "reason": "created",          "attempt": 0, "at": "..." },
    { "from": "PENDING",    "to": "PROCESSING", "reason": "start_processing", "attempt": 0, "at": "..." },
    { "from": "PROCESSING", "to": "SUCCESS",    "reason": "gateway_success",  "attempt": 1, "at": "..." }
  ]
}
```

---

### `GET /payments/:id`

Fetch a payment with its full transition history.

**Response codes**: `200`, `404`.

---

### `POST /webhooks/callback`

Receive an asynchronous status update from the gateway.

**Headers**
- `X-Webhook-Id: <unique-event-id>` (required) — used for deduplication
- `Content-Type: application/json`

**Body**
```json
{
  "paymentId": "<uuid>",
  "status": "SUCCESS",            // or "FAILED"
  "gatewayReference": "gw-...",   // optional
  "eventType": "payment.success"  // optional
}
```

**Behavior**

| Scenario | Response |
|---|---|
| First time, valid transition | `200 { status: "processed", ..., wasEarly: bool }` |
| Same `X-Webhook-Id` again | `200 { status: "duplicate" }` (no DB churn) |
| Webhook for terminal payment (conflict) | `200 { status: "rejected", reason: "STATE_CONFLICT" }` (audit-logged) |
| Unknown payment | `404` |
| Missing header / invalid status | `400` / `422` |

> Webhooks always return `2xx` (except for missing headers / unknown payments) so the gateway stops retrying.

---

## 10. Key design decisions

| Decision | Why |
|---|---|
| **Postgres, not MongoDB** | ACID, `DECIMAL(12,2)` for money, FK integrity, `SELECT FOR UPDATE` semantics, what real payment systems use |
| **Idempotency at the edge** (middleware) | Cheaper than going to DB. Redis sub-ms. DB unique constraint is the safety net |
| **Full jitter** in backoff | Prevents synchronized thundering-herd retries (AWS Architecture Blog formula) |
| **Custom error classes** with `statusCode` | Global error handler maps cleanly. `instanceof` is brittle across module boundaries — `isRetryableError` checks `error.retryable === false` directly |
| **Audit log table** (`PaymentTransition`) | Auditability. Recreates the full history of any payment for forensics |
| **Optimistic locking** (`version` column) | Cheap, doesn't hold DB row locks during gateway calls |
| **Webhook returns `200` even on conflict** | `4xx` would trigger gateway retries forever; we ack and audit-log the rejection internally |
| **`AsyncLocalStorage` for correlation IDs** | No prop-drilling. Every nested service gets the request's logger ambient |

---

## 11. Concurrency model — 4 layers of defense

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

---

## 12. Observability

Every log line is JSON (or pretty-colorized in dev) with:
- `timestamp` — ISO 8601
- `correlation_id` — UUID per request, attached to every log line for that request
- `service` — `"payment-gateway"`
- `event` — stable name like `payment_state_transition`, `retry_scheduled`, `webhook_applied`
- Plus event-specific fields (`payment_id`, `attempt`, `delay_ms`, `error_code`, …)

To trace one request's entire journey:
```bash
# In dev (after `npm run dev`)
# Filter by correlation ID:
grep 'req-7f2a8c1d' logs.txt
```

In production these JSON lines feed naturally into Datadog, Loki, CloudWatch, or any aggregator.

---

## 13. Limitations & future work

The core is complete. Optional bonus features for Phase 3:

- **Queue-based retry handling** — BullMQ + Dead Letter Queue for failed jobs
- **Circuit breaker** (Opossum) — fail fast when the gateway is down for an extended period
- **Rate limiting** — `express-rate-limit` on `POST /payments`
- **OpenAPI / Swagger docs** at `/api-docs`
- **Webhook signature verification** — HMAC-SHA256 in production
- **Test database isolation** — separate `payment_gateway_test` DB instead of truncating dev DB
- **Body-hash idempotency conflicts** — currently the same key with different body would replay the cached response; should `409 IDEMPOTENCY_CONFLICT` instead

---

## 14. Hands-on testing guide

See **[RUNBOOK.md](./RUNBOOK.md)** for a full step-by-step manual testing walkthrough — every endpoint, every scenario, with example `curl` commands and expected responses.

---

## License

MIT

---

*Built for the Mid-Level Backend Developer (Node.js) take-home assignment. Architecture references real production patterns from Stripe, Razorpay, and AWS.*
