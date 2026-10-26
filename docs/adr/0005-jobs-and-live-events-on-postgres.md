# 5. Jobs and live events run on Postgres

## Context

Benchmarks for a new BoQ version, contributing awarded prices to the history and re-estimating
regional levels take seconds to a minute. Buyers want to see bids arrive while they look at the
comparison. A queue service and a pub/sub broker would be two more systems to run and secure.

## Decision

- **Jobs** are rows in `jobs`, claimed with `FOR UPDATE SKIP LOCKED`, retried with exponential
  backoff up to five attempts, then marked failed with the last error. Handlers are idempotent
  (contributing prices checks whether the tender already contributed). The worker is a separate
  entry point (`apps/api/src/worker.ts`) and scales horizontally.
- **Events** are rows in `events`; a trigger sends `NOTIFY tender_events`. The API holds one
  `LISTEN` connection (`EventHub`) and fans events out over server-sent events, re-reading each
  event under the subscriber's organisation (ADR 1). Clients that reconnect ask for events since
  the last id they saw.

## Consequences

- One system of record; a job and the change that caused it commit together.
- Postgres `NOTIFY` is not durable; events are, so a missed notification is caught up on reconnect.
- At much higher job volume a dedicated queue would be worth it; the job table and handler
  interface keep that change local.
