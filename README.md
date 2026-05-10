# Payment Processing System

A Node.js backend that simulates how a real payment gateway behaves under stress — flaky networks, slow upstream providers, duplicate webhooks, racing clients — and shows how to keep money operations correct anyway. Built as a take-home for a Mid-Level Backend Developer (Node.js) role.

```
✅  Every functional requirement implemented
✅  Every technical expectation met
✅  All 4 bonus features shipped
✅  31 tests passing in under 3 seconds
```

---

## What's in this README

1. [Try it in 5 minutes](#try-it-in-5-minutes)
2. [The problem this system solves](#the-problem-this-system-solves)
3. [How it handles real-world chaos — scenario walkthroughs](#how-it-handles-real-world-chaos)
4. [Architecture](#architecture)
5. [Tech stack](#tech-stack)
6. [Project layout](#project-layout)
7. [API surface](#api-surface)
8. [Design choices that mattered](#design-choices-that-mattered)
9. [Concurrency model — 4 layers of defense](#concurrency-model--4-layers-of-defense)
10. [Observability](#observability)
11. [Scaling story](#scaling-story)
12. [Hands-on testing](#hands-on-testing)

---

## Try it in 5 minutes

You'll need Node.js 20+ and Docker Desktop running.

```bash
git clone https://github.com/saiteja-donthula-17/Payment-Processing-System.git
cd Payment-Processing-System
npm install
cp .env.example .env
docker compose up -d                       # Postgres 15 + Redis 7
npx prisma migrate dev --name init         # apply DB schema
npm test                                   # 31 / 31 in ~2 seconds
```

Then start the system in two terminals:

```bash
# Terminal A
npm run dev

# Terminal B
npm run worker:dev
```

Open **http://localhost:3000/api-docs** in your browser. That's a live, interactive Swagger UI for every endpoint — request bodies, response shapes, "Try it out" buttons. It's the recommended way to explore the API.

---

## The problem this system solves

A payment system lives in a hostile environment. Not "evil hackers" hostile — *normal users with normal devices* hostile.

- A customer's phone briefly loses signal mid-checkout. Their browser auto-retries. Without protection, you charge them twice.
- 5,000 customers click "Pay" during a flash sale. Each request waits 3 seconds for the gateway to respond. If the gateway is slow, every one of those requests piles up on your server.
- Your gateway provider (Razorpay, Stripe) sends a webhook saying "payment succeeded". Then their network hiccups and they retry the webhook. You receive the same event 5 times.
- The gateway responds with `INVALID_CARD`. You retry it 3 times anyway. The card is still invalid. You've wasted retry budget on something that will never succeed.

This project takes those problems seriously and addresses each one with a specific technique that real payment systems (Stripe, Razorpay, PayPal) use in production. Then it proves the solutions work with 31 automated tests.

---

## How it handles real-world chaos

Four scenarios. For each: what a naive backend does versus what this system does. The differences are the whole point.

### Scenario 1 — Customer's network blips, browser retries

Same idempotency key, two POST requests arriving 200ms apart.

```
                    NAIVE BACKEND                 │              THIS SYSTEM
─────────────────────────────────────────────────────────────────────────────────────────────
                                                  │
[Click Pay]                                       │  [Click Pay]
   │                                              │     │
   ├─→ POST /payments                             │     ├─→ POST /payments
   │                                              │     │       │
   │                                              │     │       ▼
   │                                              │     │   redis.set("idem:abc", NX)  →  OK
   │                                              │     │       │
   │                                              │     │       ▼
   │                                              │     │   process payment, charge ₹500
   │                                              │     │       │
   ├─→ POST /payments  (network retry)            │     ├─→ POST /payments  (network retry)
   │       │                                      │     │       │
   │       ▼                                      │     │       ▼
   │   process payment AGAIN                      │     │   redis.set("idem:abc", NX)  →  nil
   │       │                                      │     │       │
   │       ▼                                      │     │       ▼
   │   charge ₹500 AGAIN                          │     │   poll Redis  →  return cached response
   │                                              │     │
   ▼                                              │     ▼
₹1,000 charged, two payment rows                  │   ₹500 charged, ONE payment row
                                                  │   second response has X-Idempotent-Replay: true
```

**What it costs the company:** customer disputes, refunds, support tickets, possibly chargebacks.
**What it costs to prevent:** one Redis call, one middleware file.

### Scenario 2 — Gateway has a 30-second outage

200 customers click Pay during the outage window. Every gateway call times out at 3 seconds.

```
                    NAIVE BACKEND                 │              THIS SYSTEM
─────────────────────────────────────────────────────────────────────────────────────────────
                                                  │
200 requests arrive                               │  200 requests arrive
   │                                              │     │
   ▼                                              │     ▼
 each call gateway                                │   first 5 call gateway → all fail
   │                                              │     │
   ▼                                              │     ▼
 wait 3s × retries × 4 attempts                   │   circuit breaker observes 100% failure rate
 = ~12s per request                               │   trips → OPEN
   │                                              │     │
   ▼                                              │     ▼
 Node.js worker pool exhausted                    │   next 195 requests fail in <1ms
 fresh requests can't even hit /health            │   server stays responsive
 load balancer marks instance unhealthy           │     │
                                                  │     ▼
   ▼                                              │   30s later: breaker half-open
 SITE EFFECTIVELY DOWN                            │   trial call succeeds → CLOSED
                                                  │   normal traffic resumes automatically
```

**What it saves:** the rest of your app stays alive while the gateway recovers. Your incident becomes "10% of payments failed for 30 seconds" instead of "site went down for 5 minutes."

### Scenario 3 — Same webhook delivered 5 times

Razorpay's network can't confirm our `200 OK`, so it retries the same `payment.success` webhook. We receive 5 copies of one event.

```
                    NAIVE BACKEND                 │              THIS SYSTEM
─────────────────────────────────────────────────────────────────────────────────────────────
                                                  │
webhook arrives                                   │  webhook arrives
   │                                              │     │
   ▼                                              │     ▼
 update payment status                            │   check WebhookEvent table for X-Webhook-Id
   │                                              │     │
   ▼                                              │     ▼
 send "payment confirmed" email                   │   not seen → process, log audit row
                                                  │     │
   ──── webhook retry #2 ────                     │   ──── webhook retry #2 ────
   ▼                                              │     ▼
 update payment status AGAIN                      │   webhook id already in WebhookEvent table
   ▼                                              │     ▼
 send another email                               │   return 200 {status: "duplicate"}, do nothing
                                                  │
 (... 3 more times ...)                           │   (... 3 more times, all return duplicate ...)
   ▼                                              │     ▼
 customer gets 5 confirmation emails              │   customer gets ONE confirmation email
 audit log lies                                   │   audit log is the truth
```

### Scenario 4 — Gateway returns `INVALID_CARD` (non-retryable)

The card is invalid. Retrying won't help.

```
                    NAIVE BACKEND                 │              THIS SYSTEM
─────────────────────────────────────────────────────────────────────────────────────────────
                                                  │
gateway returns INVALID_CARD                      │  gateway returns INVALID_CARD
   │                                              │     │
   ▼                                              │     ▼
 retry with backoff (1s)                          │   isRetryableError(error) → false
   ▼                                              │     │
 retry again (2s)                                 │     ▼
   ▼                                              │   bail immediately
 retry again (4s)                                 │     │
   ▼                                              │     ▼
 retry again (8s)                                 │   transitionTo FAILED
   ▼                                              │   lastError: "INVALID_CARD"
 give up                                          │   retryCount: 1
                                                  │
total time: ~15s                                  │   total time: ~150ms
gateway hit 4 times (paid 4× transaction fees)    │   gateway hit once
```

---

## Architecture

The synchronous path (POST `/payments`) walks through six middleware/service layers. Every layer has one job; you can disable any of them by removing one file and the others keep working.

```
                ┌──────────────────────────────┐
                │   Client (curl / Swagger)    │
                └──────────────┬───────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────┐
       │   1. Request logger middleware                 │
       │      → generates correlation_id                │
       │      → child pino logger ambient via           │
       │        AsyncLocalStorage                        │
       └────────────────────────────────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────┐
       │   2. Rate limiter (per-IP, 100 / 15min)        │
       └────────────────────────────────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────┐
       │   3. Idempotency middleware                    │
       │      → redis.set("idem:<key>", NX, EX 300)     │
       │      → on duplicate: poll, return cached       │
       └────────────────────────────────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────┐
       │   4. Zod validation                            │
       │      → schemas in src/api/schemas.js           │
       └────────────────────────────────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────┐
       │   5. Controller                                │
       │      → calls payment.service                   │
       └────────────────────────────────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────┐
       │   6. payment.service.processPayment            │
       │                                                 │
       │   ┌──────────────────────────────────────┐    │
       │   │ Redis distributed lock (NX PX 60s)   │    │
       │   │   token-fenced via Lua release       │    │
       │   └──────────────────┬───────────────────┘    │
       │                      │                         │
       │   ┌──────────────────▼───────────────────┐    │
       │   │ Postgres transaction:                 │    │
       │   │   PENDING → PROCESSING                │    │
       │   │   write transition row                 │    │
       │   │   bump version (optimistic lock)      │    │
       │   └──────────────────┬───────────────────┘    │
       │                      │                         │
       │   ┌──────────────────▼───────────────────┐    │
       │   │ retry engine (exp backoff + jitter)   │    │
       │   │   ↓                                    │    │
       │   │   Opossum circuit breaker             │    │
       │   │   ↓                                    │    │
       │   │   gateway call (Promise.race timeout) │    │
       │   └──────────────────┬───────────────────┘    │
       │                      │                         │
       │   ┌──────────────────▼───────────────────┐    │
       │   │ Postgres transaction:                 │    │
       │   │   PROCESSING → SUCCESS / FAILED       │    │
       │   │   write transition row                 │    │
       │   └──────────────────────────────────────┘    │
       └────────────────────────────────────────────────┘
                               │
                               ▼
                        ┌─────────────┐
                        │  PostgreSQL │  (Payment, PaymentTransition,
                        │             │   WebhookEvent, IdempotencyRecord)
                        └─────────────┘
                               │
                        ┌─────────────┐
                        │    Redis    │  (idem:* , lock:payment:* , bull:* )
                        └─────────────┘
```

For high-throughput environments, the same `paymentService.processPayment` is also driven from a **BullMQ worker** consuming jobs enqueued by `POST /payments/async`. The worker shares the lock + retry + breaker primitives with the synchronous path — no logic duplication.

```
        Client                          Server                          Worker
        ──────                          ──────                          ──────
   POST /payments/async  ─────────►  controller                            │
                                        │                                   │
                                        ├─ create Payment (PENDING)         │
                                        ├─ enqueue BullMQ job               │
                                        │       │                           │
                          ◄────────  202 Accepted                           │
                                                │                           │
                                                └────────  (Redis queue) ──►│
                                                                            │
                                                            picks up job ───┤
                                                            calls process- ─┤
                                                            Payment(id)     │
                                                                            │
                                                            same lock, same │
                                                            retry, same     │
                                                            breaker         │
                                                                            ▼
                                                            Payment moves to
                                                            SUCCESS / FAILED
```

---

## Tech stack

| Tool | Why this one |
|---|---|
| **Node.js 20 + Express 5** | Standard for the role; Express's middleware composition fits a pipeline-of-checks model perfectly |
| **PostgreSQL 15 + Prisma 5** | ACID, `DECIMAL(12,2)` for money, `version`-based optimistic locking, declarative schema, painless migrations |
| **Redis 7 (ioredis)** | Atomic `SET NX EX` is the foundation of both idempotency and distributed locking; sub-millisecond latency |
| **BullMQ** | Production-grade Redis-backed queue, has built-in retries / DLQ |
| **Opossum** | Battle-tested circuit breaker, supports `errorFilter` so user errors don't trip it |
| **express-rate-limit** | Drop-in per-IP throttling with RFC draft-7 headers |
| **Pino + pino-pretty** | Fastest Node logger, JSON-native, pretty in dev |
| **Zod** | Schema-first validation with structured error reports |
| **Jest + Supertest** | Industry default, ergonomic |
| **Docker Compose** | Reproducible local environment for the recruiter — Postgres + Redis up with one command |

---

## Project layout

```
.
├── docker-compose.yml          # Postgres 15 + Redis 7
├── prisma/
│   ├── schema.prisma           # 4 models, indexed for retry polling
│   └── migrations/
├── src/
│   ├── api/
│   │   ├── middlewares/        # idempotency, rate limit, request logger, zod validate
│   │   ├── payment.controller.js
│   │   ├── payment.routes.js
│   │   ├── webhook.controller.js
│   │   ├── webhook.routes.js
│   │   ├── schemas.js          # zod schemas
│   │   └── swagger.js          # OpenAPI 3.0 spec
│   ├── services/
│   │   ├── gateway.service.js  # mock gateway + Opossum breaker
│   │   ├── idempotency.service.js
│   │   ├── lock.service.js     # Redis lock with token-fenced Lua release
│   │   ├── payment.service.js  # state machine + processPayment
│   │   └── retry.engine.js
│   ├── queue/
│   │   ├── connection.js       # dedicated Redis conn for BullMQ
│   │   ├── payment.queue.js
│   │   └── payment.worker.js
│   ├── db/client.js            # Prisma singleton
│   ├── redis/client.js         # ioredis singleton
│   ├── utils/
│   │   ├── backoff.js
│   │   ├── sleep.js
│   │   ├── logger.js
│   │   └── asyncContext.js     # AsyncLocalStorage for correlation IDs
│   ├── config.js
│   ├── app.js
│   ├── index.js                # API server entry
│   └── worker.js               # BullMQ worker entry
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

## API surface

Live, interactive at **http://localhost:3000/api-docs**.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/payments` | Sync: create + process a payment (responds with the final state) |
| `POST` | `/payments/async` | Async: enqueue for the BullMQ worker, return `202` immediately |
| `GET` | `/payments/:id` | Fetch a payment with its full transition history |
| `GET` | `/payments/queue/stats` | BullMQ queue health + DLQ snapshot |
| `POST` | `/webhooks/callback` | Receive async status updates from the gateway |
| `GET` | `/api-docs` | Swagger UI |
| `GET` | `/api-docs.json` | Raw OpenAPI 3.0 spec |

**Required headers:**
- `POST /payments` and `POST /payments/async` require `Idempotency-Key`
- `POST /webhooks/callback` requires `X-Webhook-Id`

---

## Design choices that mattered

A few decisions that shaped the rest of the system. None of these are arbitrary.

**Postgres over MongoDB.** Money is exact, not eventually consistent. `DECIMAL(12,2)` doesn't have float rounding errors. Foreign keys and `version`-based optimistic locking give correctness primitives that NoSQL doesn't easily replicate. Stripe, Razorpay, and Square all use SQL for their core ledger — there's a reason.

**Idempotency at the middleware edge, with the DB as a backstop.** Redis sub-millisecond lookups handle the common case. The DB unique constraint on `idempotencyKey` handles the rare case where Redis is wiped (e.g., a Redis restart). Two layers, different failure modes covered.

**Full jitter, not pure exponential backoff.** Pure exponential synchronizes 1,000 simultaneous failures to retry at exactly 1s, 2s, 4s — same thundering herd that caused the original failure. Full jitter (`random(0, exponential_delay)`) desynchronizes them. AWS Architecture Blog recommends this and it costs nothing extra.

**Audit log table for every state change.** A row in `PaymentTransition` for every `PENDING → PROCESSING`, `PROCESSING → SUCCESS`, etc., written inside the same DB transaction as the status update. If you need to debug a stuck payment three months from now, the transition log tells you the exact sequence — when it was processing, how many retries, what error, when it failed.

**Webhook returns `200` even on conflict.** A `4xx` would make the gateway retry forever. Better to ack receipt and audit-log the rejection internally. This is what Stripe and Razorpay docs both recommend.

**Async path alongside sync, not replacing it.** `POST /payments` (sync) is the simple primary path. `POST /payments/async` is for higher throughput, returns `202` immediately, BullMQ worker picks it up. Both call the same `processPayment` function — no duplication, no divergence.

**Circuit breaker excludes user errors.** A flood of `INVALID_CARD` responses doesn't mean the gateway is down — it means a flood of customers have invalid cards. The breaker's `errorFilter` only counts gateway-health failures (timeouts, transient errors). Without this, a busy bad-card week would trip the breaker and break payments for everyone.

---

## Concurrency model — 4 layers of defense

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Idempotency middleware (Redis SET NX EX)                         │
│   → prevents duplicate REQUESTS from creating duplicate payments          │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Distributed lock (Redis SET NX PX with token-fenced release)     │
│   → prevents two processes from PROCESSING the same payment concurrently  │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Optimistic locking (DB version field, updateMany WHERE version)  │
│   → catches stale writes if Redis fails or a lock expires mid-work        │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ Layer 4: State machine guards (VALID_TRANSITIONS map)                     │
│   → rejects illegal transitions even if all the above somehow fail        │
└──────────────────────────────────────────────────────────────────────────┘
```

Each layer has a different scope and cost. Layer 1 catches most cases at sub-ms cost. Layer 4 is the last-resort guard. There's no single point of failure — Redis can go down and the system stays correct, just slower.

---

## Observability

Every log line is JSON (or pretty-colorized in dev) and carries:

- A `correlation_id` UUID per request, attached to **every** log line for that request
- An `event` name (stable across restarts: `payment_state_transition`, `retry_scheduled`, `circuit_open`, etc.)
- Plus event-specific fields: `payment_id`, `attempt`, `delay_ms`, `error_code`

The HTTP response includes `X-Correlation-Id` so a customer support engineer can pull up exactly the logs that produced a given response. In production with `NODE_ENV=production`, the same lines emit as raw JSON ready for Datadog, Loki, or CloudWatch.

---

## Scaling story

The current design is horizontally scalable on day one. Here's the deployment story for going from 1 instance handling ~100 req/min to a fleet handling 10,000 req/min.

**What's already scale-ready:**
- The API process is stateless. Run N replicas behind a load balancer.
- The worker process is stateless. BullMQ handles fair distribution across workers.
- Redis is shared between instances — idempotency, locks, and queue all work cross-instance from the start.
- Postgres `version`-based optimistic locking works correctly across distributed writers without coordination.

**What you'd add when scaling out:**

| Concern | Today | At 10× scale |
|---|---|---|
| Postgres read load | Single instance | Add 1-2 read replicas; route `GET /payments/:id` there |
| Postgres write load | Single instance | Vertically scale primary; PgBouncer in transaction mode if needed |
| Redis | Single node | Redis cluster (3-shard, 1 replica each) — keys are already prefixed (`idem:`, `lock:`, `bull:`), resharding is straightforward |
| Rate limiter | In-memory per process | Switch to `rate-limit-redis` so all instances share counters |
| BullMQ workers | 1 process, concurrency 5 | Many processes × concurrency 10-20 each; auto-scale on queue depth |
| Dead Letter Queue | Inspectable via API | Alarm + Slack alert on DLQ depth > N |

**Things to watch in production:**
- Per-payment retry budget compounds with BullMQ's `attempts: 3` — total can be up to 9 gateway calls if everything retries. Tune one or the other.
- Lock TTL (60s) needs to outlast worst-case work duration including retries. With longer backoff, bump it.
- Each Node process has its own circuit breaker. With 10 instances, the gateway might trip 4 of them and not the others. Could move state to Redis but per-instance is usually fine and cheaper.

---

## Hands-on testing

For step-by-step manual testing of every scenario (happy path, network blip, concurrent dupes, webhook conflicts, etc.), see **[RUNBOOK.md](./RUNBOOK.md)**.

The automated suite is `npm test` — 31 tests across 7 suites covering the full lifecycle, idempotency under concurrency, lock contention, retry behavior, circuit breaker state machine, and every webhook path.

---

## License

MIT

---

*Architecture references real production patterns from Stripe, Razorpay, AWS Architecture Blog, and PayPal engineering writeups.*
