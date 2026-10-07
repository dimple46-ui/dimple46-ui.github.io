# M2 operational and storage stabilization

Status: code and policy candidate only. Nothing in this document authorizes a production Worker,
binding, Secret, Cron, GitHub publication cadence or D1 retention change.

## Measured pressure

- A full relay day produced about 331 GitHub snapshot commits. At 250 trading days this projects to
  82,750 commits per year. This is repository-history pressure, not a data-loss incident.
- Compact Feature v2 measured roughly 13.8–14.0 KB per run. At 331 runs per day the JSON-only
  projection is about 4.6 MB per trading day before SQLite pages, indexes and replication overhead.
- D1 query metadata and the five latest trading-day JSON totals are exposed by the read-only
  `/health` candidate. JSON totals must never be presented as total D1 storage.

## Target responsibilities

| Layer | Responsibility | Rollback/fallback |
| --- | --- | --- |
| GitHub | Code, documentation, releases and a compatibility/emergency latest snapshot | Keep current publication until all known consumers opt in and fallback tests pass |
| D1 | Immutable raw observations and compact versioned feature runs | Disable new optional writers; never rewrite or delete v1 rows during rollback |
| Read endpoint | Authenticated, bounded latest state/history/features/health | Remove only the candidate route; GitHub publication continues |
| R2 | Deferred cold archive only after measured retention pressure | No R2 account, migration or deletion is currently required |

## Additive migration gates

1. Merge code and tests without changing production deployment.
2. Deploy a separate read-only candidate only after approval, with a new token, read-only D1 binding,
   provider-level rate limit and release metadata.
3. Validate state equivalence against `market-live.json` at multiple live timestamps, including honest
   freshness/quality degradation and bounded D1 query cost.
4. Opt in one non-critical consumer while GitHub remains unchanged.
5. Inventory all consumers and prove fallback before proposing a reduced GitHub cadence.
6. Observe D1 page/index growth over at least 20 trading days. Use measured database bytes, not JSON
   estimates, before selecting a hot-retention window or R2 archive.
7. Any cadence, retention, archive or production binding change requires separate approval and an
   explicit rollback window.

## Retention policy gate

`cloudflare/operational-storage-policy.mjs` is a pure policy helper. It can summarize observed JSON
growth, expose GitHub commit pressure and classify retention planning. It always returns
`automatedDeletionAllowed: false`; it never runs SQL or changes storage.

- `MONITOR`: below 70% measured utilization and at least 120 projected trading days remain.
- `ARCHIVE_PLAN_WARNING`: utilization is at least 70% or fewer than 120 days remain.
- `ARCHIVE_PLAN_REQUIRED`: utilization is at least 85% or fewer than 60 days remain.
- `INSUFFICIENT_MEASUREMENT`: any required provider measurement is unavailable.

These thresholds trigger planning, not deletion. Archive restore tests, checksum verification and a
known-consumer inventory are mandatory before any destructive retention proposal.

## Release and observability contract

The candidate `/health` response includes:

- API/service release and supported Feature version;
- optional Worker Git SHA and Cloudflare deployment ID when configured;
- latest observation age, pipeline state and source errors;
- latest Feature v2 slot, status, cutoff and quality ceiling;
- five-day raw rows plus honest JSON-only growth projections;
- D1 rows read/written and query duration metadata where supplied;
- per-isolate request/failure counters labeled as non-global.

Worker CPU must continue to come from provider metrics. Wall time and D1 query duration are not CPU.

## Isolated candidate deployment boundary

`wrangler.intelligence-candidate.example.toml` defines only the separate
`market-intelligence-read-candidate` service. It has no route to the production relay, no GitHub
credential, no scheduled trigger and no D1 mutation handler. Its provider rate limiter is mandatory;
the Worker fails closed before D1 when the binding is absent. The example contains an intentionally
invalid zero D1 UUID and cannot be used for deployment until the existing `market-history` Database ID
is supplied. The Bearer token is always created as a Cloudflare Secret and never committed.
