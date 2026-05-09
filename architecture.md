# Payment Processing System — Complete Architecture & Build Guide

> Hand this file to Claude Code to scaffold the entire project.  
> Every decision here maps directly to a requirement in the assignment.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Why](#2-tech-stack--why)
3. [Folder Structure](#3-folder-structure)
4. [Database Schema](#4-database-schema)
5. [Complete System Flow (End to End)](#5-complete-system-flow-end-to-end)
6. [Module-by-Module Architecture](#6-module-by-module-architecture)
   - 6.1 Payment Lifecycle & State Machine
   - 6.2 Idempotency Layer
   - 6.3 Gateway Simulator
   - 6.4 Retry Engine (Exponential Backoff + Jitter)
   - 6.5 Concurrency Control
   - 6.6 Webhook Handler
   - 6.7 Queue-Based Retry (BullMQ) — Bonus
   - 6.8 Circuit Breaker — Bonus
   - 6.9 Rate Limiting — Bonus
   - 6.10 Logging & Observability
7. [API Contract](#7-api-contract)
8. [Error Handling Strategy](#8-error-handling-strategy)
9. [Testing Strategy](#9-testing-strategy)
10. [Environment & Config](#10-environment--config)
11. [How to Bootstrap with Claude Code](#11-how-to-bootstrap-with-claude-code)

---

## 1. Project Overview

A production-grade payment processing system built in **Node.js + TypeScript** that simulates how real payment gateways (like Stripe or Razorpay) handle the full lifecycle of a payment — from initiation through processing, failure recovery, and asynchronous webhook callbacks.

### What this system does

- Accepts payment requests via REST API
- Processes payments through a simulated external gateway (random success/failure/timeout)
- Handles failures gracefully with exponential backoff + jitter retries
- Guarantees no duplicate payments via idempotency keys
- Prevents race conditions via distributed locking
- Handles asynchronous gateway callbacks (webhooks) robustly
- Provides full observability via structured logs with trace IDs

### Assignment Requirements Coverage

| Requirement                                               | Covered By                                     |
| --------------------------------------------------------- | ---------------------------------------------- |
| Payment lifecycle (Pending → Processing → Success/Failed) | State machine in `PaymentService`              |
| Retry with exponential backoff                            | `RetryEngine` with full jitter                 |
| Idempotency                                               | Redis-backed middleware + DB unique constraint |
| Concurrency control                                       | `SELECT FOR UPDATE` + Redis distributed lock   |
| External gateway simulation                               | `MockGatewayService` with random outcomes      |
| Webhook/callback handling                                 | `WebhookController` with deduplication         |
| Data consistency                                          | DB transactions on every state transition      |
| Logging & observability                                   | Pino structured logger + correlation IDs       |
| Testing                                                   | Jest unit + integration tests                  |
| Queue-based retry (Bonus)                                 | BullMQ + Dead Letter Queue                     |
| Circuit breaker (Bonus)                                   | Opossum around gateway calls                   |
| Rate limiting (Bonus)                                     | express-rate-limit                             |
| API docs (Bonus)                                          | Swagger/OpenAPI at `/api-docs`                 |

---

## 2. Tech Stack & Why

| Tool                     | Purpose                                                   | Why this                                                                                |
| ------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Node.js + TypeScript** | Runtime + type safety                                     | Required by assignment. TypeScript prevents entire classes of bugs in state management. |
| **Express.js**           | HTTP framework                                            | Minimal, well-understood, easy middleware composition                                   |
| **PostgreSQL**           | Primary database                                          | ACID transactions, `SELECT FOR UPDATE`, reliable for financial data                     |
| **Redis**                | Idempotency store + distributed locks + job queue backend | Atomic `SET NX`, fast, already in most stacks                                           |
| **BullMQ**               | Job queue for retry (Bonus)                               | Built on Redis, handles retries + DLQ natively                                          |
| **Pino**                 | Structured logging                                        | Fastest Node.js logger, JSON output, great for production                               |
| **Zod**                  | Request validation                                        | Type-safe validation that integrates with TypeScript                                    |
| **Opossum**              | Circuit breaker (Bonus)                                   | Battle-tested, minimal API                                                              |
| **Jest + Supertest**     | Testing                                                   | Industry standard for Node.js unit + integration tests                                  |
| **Prisma**               | ORM / DB migrations                                       | Type-safe queries, easy migrations, integrates well with TypeScript                     |
| **swagger-ui-express**   | API docs (Bonus)                                          | Simple to integrate with Express                                                        |

---

## 3. Folder Structure

```
payment-gateway/
├── src/
│   ├── api/
│   │   ├── controllers/
│   │   │   ├── payment.controller.ts      # POST /payments, GET /payments/:id
│   │   │   └── webhook.controller.ts      # POST /webhooks/callback
│   │   ├── middlewares/
│   │   │   ├── idempotency.middleware.ts  # Idempotency key check/store
│   │   │   ├── rateLimiter.middleware.ts  # Rate limiting (Bonus)
│   │   │   ├── errorHandler.middleware.ts # Global error handler
│   │   │   └── requestLogger.middleware.ts# Attach correlation ID
│   │   └── routes/
│   │       ├── payment.routes.ts
│   │       └── webhook.routes.ts
│   │
│   ├── services/
│   │   ├── payment.service.ts             # Core business logic + state machine
│   │   ├── gateway.service.ts             # Mock external gateway
│   │   ├── retry.engine.ts                # Exponential backoff + jitter logic
│   │   ├── idempotency.service.ts         # Redis idempotency key management
│   │   └── lock.service.ts                # Redis distributed lock (Redlock)
│   │
│   ├── queue/                             # BONUS: BullMQ queue setup
│   │   ├── payment.queue.ts               # Queue definition
│   │   └── payment.worker.ts              # Worker that processes queued retries
│   │
│   ├── db/
│   │   ├── prisma/
│   │   │   └── schema.prisma              # DB schema
│   │   └── client.ts                      # Prisma client singleton
│   │
│   ├── redis/
│   │   └── client.ts                      # Redis client singleton
│   │
│   ├── config/
│   │   └── index.ts                       # All env vars in one place
│   │
│   ├── types/
│   │   ├── payment.types.ts               # PaymentStatus enum, interfaces
│   │   └── errors.types.ts                # Custom error classes
│   │
│   ├── utils/
│   │   ├── logger.ts                      # Pino logger setup
│   │   ├── backoff.ts                     # Jitter backoff formula util
│   │   └── traceId.ts                     # Correlation ID generator
│   │
│   └── app.ts                             # Express app setup + Swagger
│
├── tests/
│   ├── unit/
│   │   ├── retry.engine.test.ts
│   │   ├── payment.service.test.ts
│   │   ├── idempotency.service.test.ts
│   │   └── backoff.test.ts
│   ├── integration/
│   │   ├── payment.flow.test.ts           # Full happy path
│   │   ├── concurrent.payments.test.ts    # Race condition tests
│   │   ├── webhook.handler.test.ts
│   │   └── retry.flow.test.ts
│   └── mocks/
│       ├── gateway.mock.ts
│       └── redis.mock.ts
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── docker-compose.yml                     # Postgres + Redis
├── .env.example
├── jest.config.ts
├── tsconfig.json
└── package.json
```

---

## 4. Database Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Payment {
  id               String        @id @default(uuid())
  idempotencyKey   String        @unique                 // Prevents duplicate payments
  amount           Decimal       @db.Decimal(12, 2)
  currency         String        @default("INR")
  status           PaymentStatus @default(PENDING)

  // Gateway interaction tracking
  gatewayReference String?                              // ID returned by gateway on success
  gatewayResponse  Json?                                // Full gateway response (for debugging)

  // Retry tracking
  retryCount       Int           @default(0)
  maxRetries       Int           @default(3)
  nextRetryAt      DateTime?                            // When the next retry is scheduled
  lastError        String?                              // Last error message

  // Optimistic locking
  version          Int           @default(0)            // Incremented on every update

  // Metadata
  metadata         Json?                                // Arbitrary client data
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  processedAt      DateTime?                            // When reached terminal state

  // Relations
  transitions      PaymentTransition[]
  webhooks         WebhookEvent[]

  @@index([status, nextRetryAt])                        // For retry polling
  @@index([idempotencyKey])
}

enum PaymentStatus {
  PENDING      // Created, not yet sent to gateway
  PROCESSING   // Currently being sent to gateway
  SUCCESS      // Terminal: gateway confirmed success
  FAILED       // Terminal: exhausted retries or non-retryable error
}

model PaymentTransition {
  id          String        @id @default(uuid())
  paymentId   String
  fromStatus  PaymentStatus
  toStatus    PaymentStatus
  reason      String?                                   // Why this transition happened
  attempt     Int           @default(0)                 // Which retry attempt
  metadata    Json?
  createdAt   DateTime      @default(now())

  payment     Payment       @relation(fields: [paymentId], references: [id])

  @@index([paymentId])
}

model WebhookEvent {
  id          String   @id @default(uuid())
  webhookId   String   @unique                          // Idempotency: from gateway header
  paymentId   String
  eventType   String                                    // payment.success, payment.failed
  payload     Json                                      // Raw webhook body
  processedAt DateTime @default(now())
  status      String   @default("processed")

  payment     Payment  @relation(fields: [paymentId], references: [id])

  @@index([paymentId])
}

model IdempotencyRecord {
  key          String   @id                             // The idempotency key
  paymentId    String?
  responseCode Int
  responseBody Json
  createdAt    DateTime @default(now())
  expiresAt    DateTime                                 // TTL: 24 hours
}
```

---

## 5. Complete System Flow (End to End)

### Flow 1: Happy Path (Payment Succeeds on First Try)

```
Client
  │
  ├─ POST /payments
  │   Headers: { Idempotency-Key: "client-uuid-123" }
  │   Body:    { amount: 500, currency: "INR", metadata: {...} }
  │
  ▼
[Idempotency Middleware]
  │  Check Redis: "idem:client-uuid-123" → NOT FOUND → proceed
  │
  ▼
[Rate Limiter Middleware]         ← BONUS
  │  Check: under limit → proceed
  │
  ▼
[Request Logger Middleware]
  │  Attach correlation_id = "trace-abc-123" to every log
  │
  ▼
[Payment Controller]
  │  Validate request body with Zod
  │
  ▼
[Payment Service: createPayment()]
  │  1. Write Payment to DB → status: PENDING
  │  2. Write PaymentTransition: null → PENDING
  │  3. Return payment_id
  │
  ▼
[Payment Service: processPayment()]
  │  1. Acquire Redis distributed lock → "lock:payment:pay-id-456"
  │  2. DB transaction: SELECT FOR UPDATE → status: PENDING
  │  3. Update status → PROCESSING
  │  4. Write PaymentTransition: PENDING → PROCESSING
  │  5. Release DB row lock (commit)
  │
  ▼
[Retry Engine: executeWithRetry()]
  │  attempt = 1
  │
  ▼
[Circuit Breaker: fire()]         ← BONUS
  │  State: CLOSED → proceed
  │
  ▼
[Gateway Service: processPayment()]
  │  Simulates external API call
  │  Random outcome: SUCCESS (60%)
  │  Returns: { success: true, gatewayRef: "gw-ref-789" }
  │
  ▼
[Payment Service: handleGatewaySuccess()]
  │  1. DB transaction:
  │     - Update Payment → status: SUCCESS, gatewayReference, processedAt
  │     - Write PaymentTransition: PROCESSING → SUCCESS
  │     - Increment version (optimistic lock)
  │  2. Release Redis distributed lock
  │
  ▼
[Idempotency Middleware]
  │  Store: Redis "idem:client-uuid-123" = { status: 201, body: {...} }
  │  TTL: 24 hours
  │
  ▼
Client ← 201 Created
  {
    "id": "pay-id-456",
    "status": "SUCCESS",
    "gatewayReference": "gw-ref-789"
  }
```

---

### Flow 2: Gateway Fails → Retry with Backoff → Eventually Succeeds

```
[Retry Engine: executeWithRetry()]
  │
  ├─ attempt 1 → Gateway → TIMEOUT
  │   delay = min(30s, 2s × 2^0) + random(0, 2s) = ~3.4s
  │   Log: { event: "retry_scheduled", attempt: 1, delay_ms: 3400 }
  │
  ├─ attempt 2 → Gateway → FAILURE (transient)
  │   delay = min(30s, 2s × 2^1) + random(0, 4s) = ~6.1s
  │   Log: { event: "retry_scheduled", attempt: 2, delay_ms: 6100 }
  │
  ├─ attempt 3 → Gateway → SUCCESS
  │   → handleGatewaySuccess()
  │   Log: { event: "payment_succeeded", attempt: 3 }
  │
  └─ Done: Payment → SUCCESS
```

---

### Flow 3: All Retries Exhausted → Payment Fails Permanently

```
[Retry Engine]
  │
  ├─ attempt 1 → TIMEOUT  → retry
  ├─ attempt 2 → FAILURE  → retry
  ├─ attempt 3 → TIMEOUT  → retry
  └─ attempt 4 → max retries reached
      │
      ▼
  [Payment Service: handlePermanentFailure()]
    1. DB transaction:
       - Update Payment → status: FAILED, lastError
       - Write PaymentTransition: PROCESSING → FAILED
    2. Release Redis lock
    3. Push to Dead Letter Queue (BullMQ DLQ) ← BONUS
    4. Log: { event: "payment_permanently_failed", payment_id, attempts: 4 }
```

---

### Flow 4: Duplicate Request (Idempotency Protection)

```
Client sends POST /payments with same Idempotency-Key (network retry)
  │
  ▼
[Idempotency Middleware]
  │  Check Redis: "idem:client-uuid-123" → FOUND
  │  Return cached response immediately — NO DB write, NO gateway call
  │
Client ← Same 201 response as original (idempotent replay)
  Headers: { X-Idempotent-Replay: "true" }
```

---

### Flow 5: Concurrent Duplicate (Race Condition Prevention)

```
Two identical requests arrive at the exact same millisecond:

Request A                           Request B
    │                                   │
    ▼                                   ▼
[Idempotency Middleware]            [Idempotency Middleware]
 Redis SET NX "idem:key" →           Redis SET NX "idem:key" →
 SUCCESS (acquired)                  FAILS (already exists)
    │                                   │
    ▼                                   ▼
[Process payment normally]          [Poll Redis for result]
    │                                 (waits up to 5s for
    │                                  Request A to finish)
    ▼                                   │
[Store result in Redis]             [Redis has result now]
    │                                   │
    ▼                                   ▼
Response 201 Created               Response 201 Created (same body)
```

---

### Flow 6: Webhook Callback from Gateway

```
Gateway Server
  │
  ├─ POST /webhooks/callback
  │   Headers: { X-Webhook-Id: "wh-unique-999" }
  │   Body: { payment_id: "pay-id-456", status: "SUCCESS", gateway_ref: "gw-ref-789" }
  │
  ▼
[Webhook Controller]
  │
  ├─ Step 1: Check WebhookEvent table for webhook_id "wh-unique-999"
  │   → NOT FOUND → proceed (first time)
  │   → FOUND → return 200 OK immediately (idempotent, already processed)
  │
  ├─ Step 2: Fetch payment from DB
  │   → Check current status
  │   → If already SUCCESS or FAILED → reject update (no regression)
  │
  ├─ Step 3: Validate state transition is valid
  │   → PROCESSING → SUCCESS ✓ allowed
  │   → FAILED → SUCCESS ✗ rejected (cannot go backward)
  │
  ├─ Step 4: DB transaction
  │   → Update Payment status
  │   → Write PaymentTransition
  │   → Write WebhookEvent (marks this webhook_id as processed)
  │
  └─ Response: 200 OK
```

---

## 6. Module-by-Module Architecture

### 6.1 Payment Lifecycle & State Machine

**File:** `src/services/payment.service.ts`

```
Valid state transitions (enforced in code):

  PENDING ──────────────────────────────────► FAILED
     │                                          ▲
     │                                          │ (max retries exhausted)
     ▼                                          │
  PROCESSING ──────────────────────────────────►│
     │                                          │
     │ (gateway success)                        │ (non-retryable error)
     ▼                                          │
  SUCCESS                        PROCESSING ───►│
  (terminal)                     (terminal)

INVALID transitions that must throw:
  SUCCESS  → anything
  FAILED   → anything
  PENDING  → SUCCESS (must go through PROCESSING first)
```

**State transition logic (pseudocode):**

```typescript
const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: [PaymentStatus.PROCESSING, PaymentStatus.FAILED],
  PROCESSING: [
    PaymentStatus.SUCCESS,
    PaymentStatus.FAILED,
    PaymentStatus.PENDING,
  ],
  SUCCESS: [], // terminal — no transitions out
  FAILED: [], // terminal — no transitions out
};

function assertValidTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}
```

---

### 6.2 Idempotency Layer

**Files:**

- `src/services/idempotency.service.ts` — Redis operations
- `src/api/middlewares/idempotency.middleware.ts` — Express middleware

**How it works:**

```
Request comes in with header: Idempotency-Key: <client-generated-uuid>

Phase 1 — Before processing:
  Redis SET NX "idem:{key}" "IN_PROGRESS" EX 300
  └─ Returns OK  → this is the first request, proceed
  └─ Returns nil → duplicate or concurrent, handle separately

Phase 2 — Concurrent duplicate handling:
  If nil returned: poll Redis every 500ms for up to 5 seconds
  └─ Result appears  → return it
  └─ Timeout         → return 409 Conflict (client should retry later)

Phase 3 — After processing (success or failure):
  Redis SET "idem:{key}" <serialized_response> EX 86400   (24 hours)
  This overwrites IN_PROGRESS with the real result.
```

**Key design decisions:**

- Key is scoped: `"idem:{userId}:{idempotencyKey}"` — prevents cross-user collisions
- 24-hour TTL matches most client retry windows
- Store the full HTTP response (status code + body) so replay is identical

---

### 6.3 Gateway Simulator

**File:** `src/services/gateway.service.ts`

Simulates a real external payment provider with realistic behavior:

```typescript
interface GatewayResponse {
  success: boolean;
  gatewayReference?: string; // Present only on success
  errorCode?: string; // Present on failure
  errorMessage?: string;
}

// Outcome distribution:
// 60% → SUCCESS immediately (0–200ms delay)
// 20% → FAILURE with retryable error (transient: network issue)
// 10% → FAILURE with non-retryable error (invalid card, insufficient funds)
// 10% → TIMEOUT (hangs for 5+ seconds → triggers timeout error)

// Error codes:
// GATEWAY_TIMEOUT        → retryable
// GATEWAY_TRANSIENT_ERR  → retryable
// INVALID_CARD           → NON-retryable (don't retry these)
// INSUFFICIENT_FUNDS     → NON-retryable
// DUPLICATE_TRANSACTION  → NON-retryable
```

**Timeout handling:**

```typescript
// Wrap gateway call with Promise.race against a timeout
const gatewayCall = gateway.processPayment(payload);
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new GatewayTimeoutError()), GATEWAY_TIMEOUT_MS),
);
const result = await Promise.race([gatewayCall, timeout]);
```

---

### 6.4 Retry Engine (Exponential Backoff + Jitter)

**File:** `src/services/retry.engine.ts`

This is the PayPal fix — the exact mechanism that solves the thundering herd.

**The formula:**

```
cap      = 30,000ms  (max wait)
base     = 2,000ms   (starting wait)
attempt  = 1, 2, 3...

exponential_delay = min(cap, base × 2^attempt)
jitter            = random(0, exponential_delay)
final_delay       = exponential_delay + jitter

Attempt 1: min(30000, 2000×2^1) + random(0,4000)  = 4000 + ~2000 = ~6s
Attempt 2: min(30000, 2000×2^2) + random(0,8000)  = 8000 + ~4000 = ~12s
Attempt 3: min(30000, 2000×2^3) + random(0,16000) = 16000 + ~8000 = ~24s
```

**Retry decision logic:**

```typescript
function isRetryable(error: Error): boolean {
  // Do NOT retry these — they will never succeed
  const nonRetryable = [
    "INVALID_CARD",
    "INSUFFICIENT_FUNDS",
    "DUPLICATE_TRANSACTION",
    "INVALID_AMOUNT",
  ];
  if (error instanceof GatewayError && nonRetryable.includes(error.code)) {
    return false;
  }
  // Retry: timeouts, transient errors, network failures
  return true;
}
```

**Full retry loop (pseudocode):**

```typescript
async function executeWithRetry(
  paymentId: string,
  fn: () => Promise<GatewayResponse>,
) {
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      const result = await fn();
      return result; // SUCCESS — exit loop
    } catch (error) {
      attempt++;
      logger.warn(
        { payment_id: paymentId, attempt, error: error.message },
        "gateway_attempt_failed",
      );

      if (!isRetryable(error)) {
        throw new PermanentGatewayError(error); // Stop immediately
      }

      if (attempt > MAX_RETRIES) {
        throw new MaxRetriesExceededError(attempt); // Give up
      }

      const delay = calculateBackoffDelay(attempt);
      logger.info(
        { payment_id: paymentId, attempt, delay_ms: delay },
        "retry_scheduled",
      );
      await sleep(delay);
    }
  }
}
```

---

### 6.5 Concurrency Control

**Files:**

- `src/services/lock.service.ts` — Redis distributed lock
- Used inside `payment.service.ts` when transitioning state

**Two-layer protection:**

**Layer 1 — Redis distributed lock (prevents parallel processing):**

```
Before processing any payment:
  SET "lock:payment:{payment_id}" "worker-instance-id" NX EX 60
  └─ Got lock  → proceed to process
  └─ No lock   → another worker is processing this payment, exit

After processing (success or fail):
  DEL "lock:payment:{payment_id}"   ← always release, even on error
```

**Layer 2 — Database optimistic lock (prevents stale reads):**

```sql
-- When updating payment status:
UPDATE payments
SET status = $1, version = version + 1
WHERE id = $2
  AND version = $3    -- Must match what we read
  AND status = $4     -- Must still be in expected state
RETURNING *;

-- If 0 rows updated → version mismatch → another worker updated it → abort
```

**Why both?** Redis lock prevents the common case fast. DB version check is the safety net for edge cases (Redis crash, lock expiry before processing finishes).

---

### 6.6 Webhook Handler

**File:** `src/api/controllers/webhook.controller.ts`

Handles async callbacks from the gateway. Three hard problems:

**Problem 1 — Duplicate webhooks (same event delivered twice):**

```
Solution: Check WebhookEvent table for webhook_id before processing.
Each webhook has a unique X-Webhook-Id header.
If found → return 200 OK immediately (no re-processing).
```

**Problem 2 — Early callbacks (webhook arrives before processing finishes):**

```
Scenario: Gateway responds via webhook before our processPayment() returns.
Solution: Check payment's current status on webhook arrival.
If status = PENDING → webhook arrived early.
  → Store webhook payload, mark as PENDING_APPLICATION.
  → When processPayment() finishes, apply any stored webhooks.
```

**Problem 3 — Conflicting state (webhook says SUCCESS but payment is FAILED):**

```
Rule: Webhooks CANNOT move a payment backwards.
FAILED → SUCCESS is REJECTED (we already marked it failed, don't reopen)
SUCCESS → FAILED is REJECTED (cannot undo a confirmed success)
Only valid: PROCESSING → SUCCESS or PROCESSING → FAILED
```

---

### 6.7 Queue-Based Retry — BONUS

**Files:**

- `src/queue/payment.queue.ts`
- `src/queue/payment.worker.ts`

Instead of retrying inline (blocking a thread), failed payments are pushed to a BullMQ queue. Workers pick them up on a schedule.

```
Payment fails attempt 1
  │
  ▼
BullMQ: queue.add('retry-payment', { paymentId }, {
  delay: 6000,      // wait 6 seconds (backoff delay)
  attempts: 3,      // total retry attempts from queue
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: true,
  removeOnFail: false,   // keep in DLQ for inspection
})

Worker (payment.worker.ts) picks up the job after delay:
  → Re-fetches payment from DB
  → Checks it's still in PROCESSING (not already resolved by webhook)
  → Calls gateway again
  → On final failure → moves to Dead Letter Queue
```

**Dead Letter Queue (DLQ):**

```
Failed jobs after max attempts → BullMQ "failed" bucket
  → Can be inspected via Bull Dashboard
  → Can be manually retried
  → Alert can be triggered (email, Slack)
```

---

### 6.8 Circuit Breaker — BONUS

**File:** `src/services/gateway.service.ts` (wraps the gateway call)

```
Circuit breaker states:

  CLOSED (normal operation)
    │ failure rate > 50% in last 10 calls
    ▼
  OPEN (fail fast — don't call gateway at all)
    │ after 30 seconds
    ▼
  HALF-OPEN (test one call)
    │ succeeds
    ▼
  CLOSED (restored)
    │ fails
    ▼
  OPEN again

Configuration:
  errorThresholdPercentage: 50
  resetTimeout: 30000ms
  rollingCountTimeout: 10000ms
  rollingCountBuckets: 10
```

**Why this matters for your assignment:** If the gateway is completely down, a circuit breaker stops all payments from hanging for 5+ seconds waiting for timeouts. It fails them immediately with a clear error. This is what PayPal's new architecture effectively achieved by removing the Processor Service bottleneck.

---

### 6.9 Rate Limiting — BONUS

**File:** `src/api/middlewares/rateLimiter.middleware.ts`

```
POST /payments:
  100 requests per 15 minutes per IP
  On exceed: 429 Too Many Requests + Retry-After header

POST /webhooks/callback:
  1000 requests per 15 minutes per IP
  (higher limit — gateway callbacks are frequent)

GET /payments/:id:
  500 requests per 15 minutes per IP
```

---

### 6.10 Logging & Observability

**File:** `src/utils/logger.ts`

Every log entry includes:

```typescript
{
  // Always present
  timestamp: "2026-05-09T10:22:11.123Z",
  level: "info",
  correlation_id: "trace-abc-123",   // Same across all logs for one request
  service: "payment-gateway",

  // On payment events
  event: "payment_state_transition",
  payment_id: "pay-id-456",
  from_status: "PENDING",
  to_status: "PROCESSING",
  attempt: 1,

  // On retry events
  event: "retry_scheduled",
  delay_ms: 6100,
  error_code: "GATEWAY_TIMEOUT",

  // On errors
  event: "gateway_error",
  error_message: "...",
  stack: "..." // only in development
}
```

**What to log at each stage:**

| Event                       | Level | Key Fields                                   |
| --------------------------- | ----- | -------------------------------------------- |
| Payment created             | INFO  | payment_id, idempotency_key, amount          |
| Status transition           | INFO  | payment_id, from, to, attempt                |
| Gateway call started        | DEBUG | payment_id, attempt                          |
| Gateway success             | INFO  | payment_id, gateway_ref, duration_ms         |
| Gateway failure (retryable) | WARN  | payment_id, error_code, attempt, delay_ms    |
| Gateway failure (permanent) | ERROR | payment_id, error_code, total_attempts       |
| Retry scheduled             | INFO  | payment_id, attempt, delay_ms                |
| Max retries exhausted       | ERROR | payment_id, total_attempts                   |
| Idempotency replay          | INFO  | payment_id, idempotency_key                  |
| Webhook received            | INFO  | webhook_id, payment_id, event_type           |
| Webhook duplicate           | WARN  | webhook_id, reason: "already_processed"      |
| Webhook conflict            | ERROR | webhook_id, current_status, requested_status |
| Lock acquired               | DEBUG | payment_id, lock_key                         |
| Lock failed                 | WARN  | payment_id, reason: "already_locked"         |
| Circuit breaker open        | ERROR | gateway, failure_rate                        |

---

## 7. API Contract

### POST /payments

**Request:**

```http
POST /payments
Content-Type: application/json
Idempotency-Key: <client-generated-uuid>     ← REQUIRED

{
  "amount": 500.00,
  "currency": "INR",
  "metadata": {
    "orderId": "order-123",
    "customerId": "cust-456"
  }
}
```

**Responses:**

`201 Created` — Payment created and processed successfully

```json
{
  "id": "pay-550e8400-e29b-41d4-a716-446655440000",
  "status": "SUCCESS",
  "amount": 500.0,
  "currency": "INR",
  "gatewayReference": "gw-ref-789",
  "createdAt": "2026-05-09T10:22:11.123Z",
  "processedAt": "2026-05-09T10:22:12.456Z"
}
```

`202 Accepted` — Payment created, processing in progress (async flow)

```json
{
  "id": "pay-550e8400-...",
  "status": "PROCESSING",
  "message": "Payment is being processed. Use GET /payments/:id to check status."
}
```

`409 Conflict` — Idempotency key reuse with different payload

```json
{
  "error": "IDEMPOTENCY_CONFLICT",
  "message": "This idempotency key was used with different payment parameters."
}
```

`422 Unprocessable Entity` — Validation error

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid request",
  "details": [{ "field": "amount", "message": "Must be a positive number" }]
}
```

`429 Too Many Requests` — Rate limit hit

```json
{
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests",
  "retryAfter": 847
}
```

---

### GET /payments/:id

**Response:**

```json
{
  "id": "pay-550e8400-...",
  "status": "FAILED",
  "amount": 500.0,
  "currency": "INR",
  "retryCount": 3,
  "lastError": "GATEWAY_TIMEOUT",
  "createdAt": "2026-05-09T10:22:11.123Z",
  "transitions": [
    { "from": null, "to": "PENDING", "at": "2026-05-09T10:22:11.123Z" },
    {
      "from": "PENDING",
      "to": "PROCESSING",
      "at": "2026-05-09T10:22:11.234Z",
      "attempt": 1
    },
    {
      "from": "PROCESSING",
      "to": "PROCESSING",
      "at": "2026-05-09T10:22:17.890Z",
      "attempt": 2
    },
    {
      "from": "PROCESSING",
      "to": "PROCESSING",
      "at": "2026-05-09T10:22:30.456Z",
      "attempt": 3
    },
    {
      "from": "PROCESSING",
      "to": "FAILED",
      "at": "2026-05-09T10:22:55.789Z",
      "attempt": 4
    }
  ]
}
```

---

### POST /webhooks/callback

**Request:**

```http
POST /webhooks/callback
Content-Type: application/json
X-Webhook-Id: wh-unique-event-id-from-gateway

{
  "paymentId": "pay-550e8400-...",
  "eventType": "payment.success",
  "gatewayReference": "gw-ref-789",
  "status": "SUCCESS",
  "timestamp": "2026-05-09T10:22:12.000Z"
}
```

**Responses:**

`200 OK` — Webhook processed (or already processed — idempotent)

`400 Bad Request` — Invalid webhook payload

`409 Conflict` — State conflict (webhook contradicts current payment state)

---

## 8. Error Handling Strategy

### Custom Error Classes

```typescript
// src/types/errors.types.ts

class AppError extends Error {
  constructor(
    public message: string,
    public code: string,
    public statusCode: number,
    public isRetryable: boolean = false,
  ) {
    super(message);
  }
}

class GatewayError extends AppError {}
class GatewayTimeoutError extends GatewayError {
  constructor() {
    super("Gateway timed out", "GATEWAY_TIMEOUT", 504, true); // retryable
  }
}
class GatewayTransientError extends GatewayError {
  constructor() {
    super("Gateway transient failure", "GATEWAY_TRANSIENT_ERR", 502, true);
  }
}
class InvalidCardError extends GatewayError {
  constructor() {
    super("Invalid card details", "INVALID_CARD", 422, false); // NOT retryable
  }
}
class InsufficientFundsError extends GatewayError {
  constructor() {
    super("Insufficient funds", "INSUFFICIENT_FUNDS", 422, false);
  }
}

class InvalidStateTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(
      `Cannot transition from ${from} to ${to}`,
      "INVALID_TRANSITION",
      409,
      false,
    );
  }
}

class IdempotencyConflictError extends AppError {
  constructor() {
    super(
      "Idempotency key reused with different params",
      "IDEMPOTENCY_CONFLICT",
      409,
      false,
    );
  }
}

class PaymentNotFoundError extends AppError {
  constructor(id: string) {
    super(`Payment ${id} not found`, "PAYMENT_NOT_FOUND", 404, false);
  }
}

class MaxRetriesExceededError extends AppError {
  constructor(attempts: number) {
    super(
      `Failed after ${attempts} attempts`,
      "MAX_RETRIES_EXCEEDED",
      502,
      false,
    );
  }
}
```

### Global Error Handler Middleware

```typescript
// Catches all unhandled errors, formats them consistently
// Logs full stack in development, sanitized message in production
// Never exposes internal error details to clients in production
```

---

## 9. Testing Strategy

### Unit Tests

| Test File                     | What It Tests                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `backoff.test.ts`             | Jitter formula produces values within expected range; never exceeds cap                |
| `retry.engine.test.ts`        | Retries on retryable errors; stops immediately on non-retryable; respects max attempts |
| `payment.service.test.ts`     | State transition validation; rejects invalid transitions; correct DB calls             |
| `idempotency.service.test.ts` | Redis SET NX called correctly; cached response returned on duplicate                   |

### Integration Tests

| Test File                     | What It Tests                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `payment.flow.test.ts`        | Full happy path end-to-end; payment created → SUCCESS in DB                                  |
| `retry.flow.test.ts`          | Gateway fails N times, succeeds on N+1; correct state in DB after each attempt               |
| `concurrent.payments.test.ts` | Fire 10 identical requests simultaneously; only 1 payment created                            |
| `webhook.handler.test.ts`     | Duplicate webhook same ID processed once; early webhook handled; conflicting status rejected |
| `permanent.failure.test.ts`   | Gateway always fails; payment ends in FAILED after max retries                               |

### Key Test Scenarios to Cover

```
✓ Happy path: payment created → gateway success → SUCCESS
✓ Retry success: gateway fails twice, succeeds third → SUCCESS
✓ Permanent failure: gateway always fails → FAILED after max retries
✓ Non-retryable error: invalid card → FAILED immediately (no retries)
✓ Idempotency: same key sent twice → second returns cached result
✓ Concurrent idempotency: 10 same-key requests fire at once → 1 processes, 9 wait
✓ Race condition: 2 workers pick same payment → only 1 processes (lock works)
✓ Webhook happy path: PROCESSING → SUCCESS via webhook
✓ Webhook duplicate: same webhook_id sent twice → processed once
✓ Webhook early: webhook arrives while payment still PENDING
✓ Webhook conflict: webhook says SUCCESS but payment is FAILED → rejected
✓ Circuit breaker: after 5 failures, next call fails fast without calling gateway
✓ Rate limit: 101st request in window → 429 response
```

---

## 10. Environment & Config

```env
# .env.example

# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/payment_gateway

# Redis
REDIS_URL=redis://localhost:6379

# Payment processing config
MAX_RETRIES=3
RETRY_BASE_DELAY_MS=2000
RETRY_CAP_MS=30000
GATEWAY_TIMEOUT_MS=5000

# Idempotency
IDEMPOTENCY_TTL_SECONDS=86400

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Circuit breaker (Bonus)
CIRCUIT_BREAKER_ERROR_THRESHOLD=50
CIRCUIT_BREAKER_RESET_TIMEOUT_MS=30000

# Logging
LOG_LEVEL=info
```

---

## 11. How to Bootstrap with Claude Code

Open Claude Code in your project folder and run these prompts **in order**. Each one builds on the previous.

---

### Prompt 1 — Project Setup

```
Set up a new Node.js + TypeScript project called payment-gateway.

Create:
- package.json with these dependencies: express, typescript, @types/express, @types/node,
  prisma, @prisma/client, redis, ioredis, bullmq, pino, pino-pretty, zod,
  opossum, @types/opossum, express-rate-limit, swagger-ui-express,
  swagger-jsdoc, uuid, @types/uuid
- devDependencies: jest, @types/jest, ts-jest, supertest, @types/supertest,
  nodemon, ts-node
- tsconfig.json with strict mode, target ES2020, module commonjs, outDir dist/
- jest.config.ts configured for TypeScript
- .env.example from the config section in ARCHITECTURE.md
- docker-compose.yml that starts postgres:15 and redis:7-alpine
- A basic src/app.ts that creates an Express app, registers middlewares,
  and exports it
- src/index.ts that starts the server on PORT from env

Do NOT implement any business logic yet. Just scaffold the project.
```

---

### Prompt 2 — Database Schema

```
Using the schema in ARCHITECTURE.md section 4, set up Prisma:

1. Create prisma/schema.prisma with the Payment, PaymentTransition,
   WebhookEvent, and IdempotencyRecord models exactly as defined
2. Create src/db/client.ts — singleton Prisma client
3. Create src/redis/client.ts — singleton Redis client using ioredis
4. Run: npx prisma generate
5. Create a seed script at prisma/seed.ts that creates 2 sample payments

The PaymentStatus enum must have: PENDING, PROCESSING, SUCCESS, FAILED
```

---

### Prompt 3 — Types & Errors

```
Create the foundational types for the payment system:

1. src/types/payment.types.ts:
   - Re-export PaymentStatus from Prisma
   - Interface CreatePaymentDTO { amount, currency, metadata? }
   - Interface PaymentResponse (the API response shape from section 7)
   - Interface GatewayResponse { success, gatewayReference?, errorCode?, errorMessage? }

2. src/types/errors.types.ts:
   Create ALL custom error classes from ARCHITECTURE.md section 8:
   - AppError (base)
   - GatewayError, GatewayTimeoutError, GatewayTransientError
   - InvalidCardError, InsufficientFundsError
   - InvalidStateTransitionError
   - IdempotencyConflictError, PaymentNotFoundError, MaxRetriesExceededError

3. src/utils/logger.ts:
   - Set up Pino logger with correlation_id in every log
   - Pretty print in development, JSON in production

4. src/utils/traceId.ts:
   - generateTraceId() → returns a short UUID string
```

---

### Prompt 4 — Gateway Simulator

```
Create src/services/gateway.service.ts — the mock external payment gateway.

Implement a MockGatewayService class with:
- processPayment(paymentId: string, amount: number): Promise<GatewayResponse>

Outcome distribution (use Math.random()):
  - 60%: SUCCESS after random 50–200ms delay
    Returns: { success: true, gatewayReference: "gw-{uuid}" }
  - 20%: FAILURE with GatewayTransientError after 100–500ms
  - 10%: FAILURE with specific non-retryable errors randomly:
    - InvalidCardError or InsufficientFundsError
  - 10%: TIMEOUT — waits 6000ms then throws GatewayTimeoutError

The gateway call itself must have a timeout wrapper using Promise.race()
with GATEWAY_TIMEOUT_MS from config.

Also export: isRetryableError(error: Error): boolean
  Returns false for: InvalidCardError, InsufficientFundsError
  Returns true for: GatewayTimeoutError, GatewayTransientError, generic Error
```

---

### Prompt 5 — Backoff Utility + Retry Engine

```
Create two files:

1. src/utils/backoff.ts:
   Export: calculateBackoffDelay(attempt: number): number
   Formula: min(RETRY_CAP_MS, RETRY_BASE_DELAY_MS × 2^attempt) + random(0, min(cap, base × 2^attempt))
   This is full jitter as described in ARCHITECTURE.md section 6.4
   Values come from config.

   Also export: sleep(ms: number): Promise<void>

2. src/services/retry.engine.ts:
   Export: executeWithRetry<T>(
     paymentId: string,
     fn: () => Promise<T>,
     maxRetries: number
   ): Promise<T>

   Implements the retry loop from ARCHITECTURE.md section 6.4:
   - Catches errors, checks isRetryableError()
   - On retryable: logs attempt, calculates delay, sleeps, retries
   - On non-retryable: throws PermanentGatewayError immediately
   - After max retries: throws MaxRetriesExceededError
   - Logs every attempt with: payment_id, attempt number, error_code, delay_ms
```

---

### Prompt 6 — Idempotency Service

```
Create the idempotency layer:

1. src/services/idempotency.service.ts:
   class IdempotencyService using ioredis:

   - async acquire(key: string, userId?: string): Promise<boolean>
     Redis: SET "idem:{userId}:{key}" "IN_PROGRESS" NX EX 300
     Returns true if acquired, false if already exists

   - async getResult(key: string, userId?: string): Promise<StoredResponse | null>
     Returns the stored response if complete, null if IN_PROGRESS or not found

   - async storeResult(key: string, response: StoredResponse, userId?: string): Promise<void>
     Redis: SET "idem:{userId}:{key}" JSON.stringify(response) EX 86400

   - async pollForResult(key: string, userId?: string, timeoutMs = 5000): Promise<StoredResponse | null>
     Polls every 500ms until result appears or timeout

2. src/api/middlewares/idempotency.middleware.ts:
   Express middleware that:
   - Reads Idempotency-Key header (required for POST /payments)
   - If missing: returns 400 Bad Request
   - Calls idempotencyService.acquire()
   - If acquired: attach key to req, proceed to next()
   - If not acquired: call pollForResult()
     - If result found: return it with X-Idempotent-Replay: true header
     - If timeout: return 409 with message to retry
   - After response is sent: call storeResult() with status + body
```

---

### Prompt 7 — Lock Service + Payment Service

```
Create the core payment processing logic:

1. src/services/lock.service.ts:
   class LockService using ioredis:
   - async acquire(paymentId: string, ttlMs = 60000): Promise<boolean>
     Redis: SET "lock:payment:{paymentId}" "1" NX PX ttlMs
   - async release(paymentId: string): Promise<void>
     Redis: DEL "lock:payment:{paymentId}"
   - async withLock<T>(paymentId: string, fn: () => Promise<T>): Promise<T>
     Acquires lock, runs fn, always releases in finally block

2. src/services/payment.service.ts:
   class PaymentService:

   - async createPayment(dto: CreatePaymentDTO, idempotencyKey: string): Promise<Payment>
     1. Creates Payment in DB with status PENDING
     2. Creates initial PaymentTransition (null → PENDING)
     3. Returns the payment

   - async processPayment(paymentId: string): Promise<Payment>
     Using lockService.withLock():
       1. Fetch payment with SELECT FOR UPDATE (Prisma: $queryRaw or transaction)
       2. assertValidTransition(PENDING, PROCESSING)
       3. Update status → PROCESSING, increment version
       4. Write PaymentTransition (PENDING → PROCESSING)
       5. Call executeWithRetry() → gatewayService.processPayment()
       6. On success: update → SUCCESS, write transition, set processedAt
       7. On failure: update → FAILED, write transition, set lastError

   - private async transitionStatus(paymentId, from, to, reason?, attempt?): Promise<void>
     Validates transition, runs DB transaction to update Payment + write PaymentTransition
     Uses optimistic locking (version check in WHERE clause)

   - async getPayment(paymentId: string): Promise<PaymentWithTransitions>
     Fetches payment + all transitions ordered by createdAt
```

---

### Prompt 8 — Controllers & Routes

```
Create the API layer:

1. src/api/controllers/payment.controller.ts:
   - createPayment handler:
     1. Validate body with Zod schema
     2. Call paymentService.createPayment()
     3. Call paymentService.processPayment()
     4. Return appropriate response (201 if SUCCESS, 202 if still PROCESSING)

   - getPayment handler:
     1. paymentService.getPayment(req.params.id)
     2. Return payment with transitions array

2. src/api/controllers/webhook.controller.ts:
   Implement the full webhook flow from ARCHITECTURE.md section 6.6:
   - Check X-Webhook-Id header (required)
   - Check WebhookEvent table for duplicate
   - Fetch payment, validate state transition
   - DB transaction: update payment + write WebhookEvent + write PaymentTransition
   - Return 200 OK always (even for duplicates — gateway won't keep retrying)

3. src/api/middlewares/errorHandler.middleware.ts:
   - Catches AppError instances → returns their statusCode + code + message
   - Catches ZodError → returns 422 with field details
   - Catches unknown errors → logs full error, returns 500 (no internal details in production)

4. src/api/middlewares/requestLogger.middleware.ts:
   - Generates traceId for each request
   - Attaches to req object and logger context
   - Logs: method, path, status, duration_ms on response

5. src/api/routes/payment.routes.ts and webhook.routes.ts
6. Register all routes in src/app.ts with idempotency middleware on POST /payments
```

---

### Prompt 9 — Tests

```
Write the test suite as described in ARCHITECTURE.md section 9.

Priority order:
1. tests/unit/backoff.test.ts — test the jitter formula
2. tests/unit/retry.engine.test.ts — mock the gateway, test retry behavior
3. tests/unit/payment.service.test.ts — mock DB and Redis, test state transitions
4. tests/integration/payment.flow.test.ts — real DB (test database), happy path
5. tests/integration/concurrent.payments.test.ts — fire 10 concurrent requests

For integration tests:
- Use a separate TEST_DATABASE_URL pointing to a test DB
- Reset DB before each test: DELETE all records
- Use Supertest for HTTP-level integration tests

Mock the gateway in most tests — only test gateway simulator separately.
Make the gateway outcome configurable via a test helper:
  setGatewayOutcome('success' | 'timeout' | 'invalid_card' | 'transient_failure')
```

---

### Prompt 10 — Bonus Features + README

```
Add the bonus features:

1. BullMQ queue (src/queue/):
   - payment.queue.ts: define queue with Redis connection from config
   - payment.worker.ts: worker that processes retry jobs
   - In payment.service.ts: on failure, add to queue instead of failing immediately

2. Circuit breaker (in gateway.service.ts):
   - Wrap processPayment with opossum
   - Config from ARCHITECTURE.md section 6.8
   - On circuit open: throw CircuitBreakerOpenError with clear message

3. Rate limiting:
   - Add express-rate-limit middleware as defined in section 6.9

4. Swagger docs:
   - Add swagger-jsdoc + swagger-ui-express
   - Document all 3 endpoints with request/response schemas
   - Serve at GET /api-docs

5. Create README.md that includes:
   - How to run (docker-compose up, npm run dev)
   - Architecture overview (summarize ARCHITECTURE.md)
   - Key design decisions and trade-offs you made
   - How you'd scale this to 10x traffic
   - How to run tests
```

---

## Quick Reference — The Assignment Checklist

Use this before submitting:

```
Core Requirements:
[ ] POST /payments — creates and processes a payment
[ ] GET /payments/:id — returns status + full transition history
[ ] Payment states: PENDING, PROCESSING, SUCCESS, FAILED
[ ] Invalid state transitions throw errors (not silently ignored)
[ ] Retry logic with exponential backoff (not fixed delay)
[ ] Jitter is applied (not pure exponential)
[ ] Non-retryable errors fail immediately without retrying
[ ] Max retry limit is configurable (from env)
[ ] Idempotency-Key header is required for POST /payments
[ ] Duplicate request with same key returns same response
[ ] Concurrent duplicate requests: only 1 processes
[ ] SELECT FOR UPDATE or Redis lock prevents parallel processing of same payment
[ ] POST /webhooks/callback handles duplicate webhooks (idempotent)
[ ] Webhook state conflicts are rejected
[ ] Every state transition is written to PaymentTransition table
[ ] DB transactions used on every multi-step operation
[ ] Optimistic locking (version field) on payment updates
[ ] Pino structured JSON logs on every significant event
[ ] Correlation ID present in every log for a request
[ ] Gateway simulator has: success, transient failure, non-retryable failure, timeout
[ ] All errors use custom error classes (not raw throw new Error())
[ ] Global error handler middleware catches all unhandled errors

Testing:
[ ] Unit tests for: backoff formula, retry engine, state machine
[ ] Integration test: full payment success flow
[ ] Integration test: retry then succeed
[ ] Integration test: permanent failure (max retries)
[ ] Integration test: 10 concurrent same-key requests → 1 payment
[ ] Test: non-retryable error fails immediately
[ ] Test: webhook duplicate ignored

Bonus:
[ ] BullMQ queue for retries
[ ] Dead Letter Queue for permanently failed jobs
[ ] Circuit breaker around gateway calls
[ ] Rate limiting on POST /payments
[ ] Swagger/OpenAPI docs at /api-docs
[ ] README explains architecture + trade-offs + scaling approach
```

---

_Architecture designed for: Payment Processing System Assignment — Backend Developer (Node.js)_  
_All patterns reference real production implementations (Stripe, PayPal, AWS)_
