# RUNBOOK — Hands-on testing guide

A flow-by-flow walkthrough of everything we built, with copy-paste `curl` commands and what to expect at each step. Read top-to-bottom the first time.

---

## 0. TL;DR — bring the whole system up in 4 commands

```bash
docker compose up -d                     # 1. start Postgres + Redis
npm install                              # 2. install deps (only first time)
npx prisma migrate dev --name init       # 3. apply DB schema (only first time)
npm run dev                              # 4. start the API server
```

In another terminal:
```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

---

## 1. What's running and where

| Service | Where | How to verify |
|---|---|---|
| Postgres | `localhost:5432` (in container `payment_db`) | `docker exec payment_db pg_isready -U postgres` |
| Redis | `localhost:6379` (in container `payment_redis`) | `docker exec payment_redis redis-cli PING` |
| API server | `http://localhost:3000` | `curl http://localhost:3000/health` |

If any is down:
```bash
docker compose ps               # shows status (should say "healthy")
docker compose up -d            # start anything that's stopped
docker compose logs db          # peek at Postgres logs
docker compose logs redis       # peek at Redis logs
```

---

## 2. The endpoints we have

| Method | Path | What it does |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/payments` | Create + process a payment (with retry, lock, idempotency) |
| `GET` | `/payments/:id` | Fetch a payment with full transition history |
| `POST` | `/webhooks/callback` | Receive an async status update from the gateway |

Every `POST /payments` requires header `Idempotency-Key`.
Every `POST /webhooks/callback` requires header `X-Webhook-Id`.

---

## 3. SCENARIO — Happy path

**Goal:** Create a payment, watch it succeed, fetch it back.

### Step A — Create a payment

```bash
curl -i -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-first-payment-001' \
  -d '{"amount": 500, "currency": "INR", "metadata": {"orderId": "order-1"}}'
```

**Expected response (status code in first line):**
- `201 Created` if the gateway returned success (~60% of the time)
- `422 Unprocessable Entity` if the gateway returned a non-retryable error (~10%)
- Either way, the body has the full payment object with `transitions` array.

### Step B — Read the response carefully

Look for:
- `id` — the payment's UUID. **Save this for Step C.**
- `status` — `SUCCESS` or `FAILED`
- `gatewayReference` — present on success
- `retryCount` — 1 means succeeded on first attempt; 2+ means it retried
- `lastError` — set on failure
- `transitions` — the audit log

### Step C — Fetch the payment

```bash
PAYMENT_ID="<id from step A>"
curl http://localhost:3000/payments/$PAYMENT_ID | python3 -m json.tool
```

You should see the same payment with the full `transitions` array.

### Step D — Verify it's in Postgres

```bash
docker exec payment_db psql -U postgres -d payment_gateway \
  -c "SELECT id, status, \"retryCount\" FROM \"Payment\" WHERE id = '$PAYMENT_ID';"
```

---

## 4. SCENARIO — Retry that eventually succeeds

The mock gateway is randomized (60% success / 20% transient / 10% non-retryable / 10% timeout). To see retries in action, just fire enough payments and look for ones with `retryCount: 2` or `3`:

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -X POST http://localhost:3000/payments \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: retry-demo-$RANDOM" \
    -d '{"amount": 100}' \
    | python3 -c "import sys,json;p=json.load(sys.stdin);print(f\"status={p['status']} retries={p['retryCount']} lastError={p.get('lastError')}\")"
done
```

You'll see a mix:
- `status=SUCCESS retries=1 lastError=None` — first-attempt success
- `status=SUCCESS retries=2 lastError=GATEWAY_TIMEOUT` — failed once, then succeeded
- `status=FAILED retries=1 lastError=INVALID_CARD` — non-retryable, no retries
- `status=FAILED retries=4 lastError=GATEWAY_TIMEOUT` — exhausted all 3 retries

---

## 5. SCENARIO — Idempotency (the duplicate-prevention story)

**Goal:** Same idempotency key sent twice → second returns the cached response, NO new payment created.

### Step A — Send a payment with a stable key

```bash
curl -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: stable-key-abc123' \
  -d '{"amount": 250}'
```

Note the `id` and `gatewayReference`.

### Step B — Send the SAME key again

```bash
curl -i -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: stable-key-abc123' \
  -d '{"amount": 250}'
```

**Look in the response headers** — you should see:
```
X-Idempotent-Replay: true
```

The body is **byte-for-byte identical** to step A. Same `id`, same `gatewayReference`. **No new payment was created.**

### Step C — Verify in Postgres

```bash
docker exec payment_db psql -U postgres -d payment_gateway \
  -c "SELECT COUNT(*) FROM \"Payment\" WHERE \"idempotencyKey\" = 'stable-key-abc123';"
```

Count is `1`.

### Step D — Inspect Redis

```bash
docker exec payment_redis redis-cli GET "idem:stable-key-abc123"
docker exec payment_redis redis-cli TTL "idem:stable-key-abc123"
```

You'll see the cached JSON response and a TTL ~86400 seconds (24h).

---

## 6. SCENARIO — Concurrent same-key requests (race condition)

**Goal:** Fire 5 requests with the same key at the exact same instant. Without our middleware, you'd get 5 payments. With it, you get 1.

```bash
KEY="concurrent-test-$(date +%s)"
for i in 1 2 3 4 5; do
  curl -s -X POST http://localhost:3000/payments \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $KEY" \
    -d '{"amount": 99}' &
done
wait

echo "---"
docker exec payment_db psql -U postgres -d payment_gateway \
  -c "SELECT COUNT(*) FROM \"Payment\" WHERE \"idempotencyKey\" = '$KEY';"
```

Expected: count = **1**. The other 4 requests polled Redis and returned the same cached response.

---

## 7. SCENARIO — Validation errors

```bash
# Missing Idempotency-Key
curl -i -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -d '{"amount": 100}'
# → 400 IDEMPOTENCY_KEY_REQUIRED

# Negative amount
curl -i -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: bad-amount-001' \
  -d '{"amount": -50}'
# → 422 VALIDATION_ERROR with "Too small: expected number to be >0"

# Currency too long
curl -i -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: bad-currency-001' \
  -d '{"amount": 100, "currency": "DOLLARS"}'
# → 422 VALIDATION_ERROR with "Too big: expected string to have <=3 characters"

# Missing amount
curl -i -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: missing-001' \
  -d '{}'
# → 422 VALIDATION_ERROR with "expected number, received undefined"
```

---

## 8. SCENARIO — Webhooks

The mock gateway is synchronous, so to test the webhook endpoint we'll either:
- Use the **automated test suite** (`npm test`) which seeds payments in specific states, OR
- Manually create a payment, then `curl` the webhook endpoint pretending to be the gateway.

### Step A — Webhook for an existing payment

First, create a payment and get its id:
```bash
RESP=$(curl -s -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: wh-demo-$RANDOM" \
  -d '{"amount": 100}')
PAYMENT_ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "Payment ID: $PAYMENT_ID"
echo "Initial status: $(echo $RESP | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")"
```

Now send a webhook for it. If the payment is already in a terminal state (SUCCESS or FAILED), the webhook will be **rejected as a conflict** — that's the correct behavior:

```bash
curl -i -X POST http://localhost:3000/webhooks/callback \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Id: wh-event-$RANDOM" \
  -d "{
    \"paymentId\": \"$PAYMENT_ID\",
    \"status\": \"SUCCESS\",
    \"gatewayReference\": \"gw-from-webhook\",
    \"eventType\": \"payment.success\"
  }"
```

Expected: `200 {"status":"rejected","reason":"STATE_CONFLICT", ...}` (because the payment is already terminal). Even rejected, the webhook is **audit-logged** in the `WebhookEvent` table:

```bash
docker exec payment_db psql -U postgres -d payment_gateway \
  -c "SELECT \"webhookId\", status FROM \"WebhookEvent\" ORDER BY \"processedAt\" DESC LIMIT 5;"
```

### Step B — Duplicate webhook handling

Send the same `X-Webhook-Id` twice:

```bash
WID="dup-test-$RANDOM"
curl -s -X POST http://localhost:3000/webhooks/callback \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Id: $WID" \
  -d '{"paymentId":"some-id","status":"SUCCESS"}'

# Second time — same X-Webhook-Id
curl -i -X POST http://localhost:3000/webhooks/callback \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Id: $WID" \
  -d '{"paymentId":"some-id","status":"SUCCESS"}'
```

Expected on the second call: `200 {"status":"duplicate"}`.

### Step C — Test ALL webhook scenarios in one shot

The integration test suite `tests/integration/webhook.test.js` covers everything:
- Missing header → 400
- Invalid status enum → 422
- Normal apply (PROCESSING → SUCCESS)
- Duplicate webhookId → idempotent
- Early callback (PENDING → SUCCESS)
- Terminal payment conflict → rejected, audit-logged
- Unknown payment → 404

```bash
npx jest tests/integration/webhook.test.js --verbose
```

---

## 9. SCENARIO — Inspecting Postgres directly

```bash
# All payments (newest first)
docker exec payment_db psql -U postgres -d payment_gateway -c \
  "SELECT id, status, \"retryCount\", \"lastError\", version, \"createdAt\"
   FROM \"Payment\" ORDER BY \"createdAt\" DESC LIMIT 10;"

# Audit log for a specific payment
PAYMENT_ID="<your-id>"
docker exec payment_db psql -U postgres -d payment_gateway -c \
  "SELECT \"fromStatus\", \"toStatus\", reason, attempt, \"createdAt\"
   FROM \"PaymentTransition\"
   WHERE \"paymentId\" = '$PAYMENT_ID'
   ORDER BY \"createdAt\" ASC;"

# Webhook events
docker exec payment_db psql -U postgres -d payment_gateway -c \
  "SELECT \"webhookId\", \"paymentId\", \"eventType\", status FROM \"WebhookEvent\" LIMIT 10;"

# Counts
docker exec payment_db psql -U postgres -d payment_gateway -c \
  "SELECT
    (SELECT COUNT(*) FROM \"Payment\") AS payments,
    (SELECT COUNT(*) FROM \"PaymentTransition\") AS transitions,
    (SELECT COUNT(*) FROM \"WebhookEvent\") AS webhooks;"
```

Or use **Prisma Studio** (a GUI in your browser):
```bash
npx prisma studio
# Opens http://localhost:5555
```

---

## 10. SCENARIO — Inspecting Redis directly

```bash
# All idempotency keys
docker exec payment_redis redis-cli KEYS 'idem:*'

# Read a specific cached response
docker exec payment_redis redis-cli GET 'idem:stable-key-abc123'

# Check TTL (seconds remaining)
docker exec payment_redis redis-cli TTL 'idem:stable-key-abc123'

# All distributed locks (should be empty when no payment is mid-processing)
docker exec payment_redis redis-cli KEYS 'lock:payment:*'

# Live monitor — every command Redis receives, in real time
docker exec -it payment_redis redis-cli MONITOR
# Then in another terminal, fire a curl. Press Ctrl+C to stop monitoring.
```

---

## 11. SCENARIO — Reading the structured logs

When you run `npm run dev`, every request emits a sequence of log lines, all sharing one `correlation_id`. Trace one payment end-to-end like this:

```bash
# Fire a request and grab the correlation ID from the response header
curl -i -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: log-trace-$RANDOM" \
  -d '{"amount": 100}' 2>&1 | grep -i 'X-Correlation-Id'
# → X-Correlation-Id: req-abc123de
```

Then in your server-running terminal, find that same `correlation_id: "req-abc123de"` across these events:
- `request_started`
- `idempotency_acquired`
- `payment_created`
- `payment_state_transition` (PENDING → PROCESSING)
- `gateway_succeeded` or `retry_scheduled` or `gateway_non_retryable`
- `payment_state_transition` (PROCESSING → SUCCESS/FAILED)
- `request_completed`

In production with `NODE_ENV=production`, those same lines come out as JSON ready for Datadog / Loki / CloudWatch.

---

## 12. SCENARIO — Run the full automated test suite

```bash
npm test
```

Expected:
```
Test Suites: 5 passed, 5 total
Tests:       26 passed, 26 total
```

Per-suite:
```bash
npm run test:unit         # backoff math + retry engine (no DB needed)
npm run test:integration  # full HTTP + DB + Redis flows
```

---

## 13. Stopping & cleaning up

```bash
# Stop the server: Ctrl+C in its terminal

# Stop containers (data preserved on volumes)
docker compose down

# Stop AND wipe data
docker compose down -v

# Reset DB without wiping (re-run migrations)
npx prisma migrate reset
```

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ECONNREFUSED` on port 5432 / 6379 | Containers not up | `docker compose up -d` |
| Tests hang | Connections not closing cleanly | Tests already use `--forceExit`; if it persists, restart Redis: `docker compose restart redis` |
| `P2002 unique violation` on `idempotencyKey` | DB has the key but Redis was wiped | Either use a fresh key, or `npx prisma migrate reset` to wipe everything |
| Lock keys piling up | `withLock` interrupted before release | They auto-expire (60s TTL). Or `docker exec payment_redis redis-cli FLUSHDB` |
| Gateway always succeeds / always fails | The mock is randomized — try a few requests | Run with more iterations to see all outcomes |

---

## Quick reference card

```bash
# Start the world
docker compose up -d
npm run dev

# Smoke test
curl http://localhost:3000/health

# Create a payment
curl -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: <unique-uuid>' \
  -d '{"amount": 500}'

# Get a payment
curl http://localhost:3000/payments/<id>

# Send a webhook
curl -X POST http://localhost:3000/webhooks/callback \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Id: <unique-uuid>' \
  -d '{"paymentId": "<id>", "status": "SUCCESS"}'

# Run all tests
npm test

# Inspect DB
npx prisma studio

# Stop everything
docker compose down
```
