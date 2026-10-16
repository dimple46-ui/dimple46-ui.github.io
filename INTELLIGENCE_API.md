# Read-only intelligence API candidate

Status: deployment-ready isolated candidate code; not yet deployed. It does not replace the
production relay or the GitHub `market-live.json` fallback.

## Purpose

Provide a bounded, authenticated route from ChatGPT-style commands such as `current situation`,
`short term` and `scenario` to the immutable D1 observation and compact Feature v2 records. The API
does not accept SQL, does not mutate D1, and does not expose Worker secrets.

## Routes

| Route | Fixed data access | Limits |
| --- | --- | --- |
| `GET /health` | Release identity, latest observation/Feature v2 run and five-day JSON growth projection | Four fixed SELECT queries |
| `GET /state?ticker=&cutoffMs=` | Latest observation available at or before the cutoff | `005930`, `000660` or explicit combined scope; one row |
| `GET /features?ticker=&featureVersion=2&slotMs=&cutoffMs=` | Latest or exact immutable compact Feature v2 row | Allowed ticker or combined scope; Feature version 2 only; one row |
| `GET /history?ticker=&fromMs=&toMs=&limit=&cutoffMs=` | Past-only raw observations | Ticker required: `005930` or `000660`; at most 12 hours, 120 rows and 900 KB response |

Every response includes `apiSchemaVersion`, the requested input cutoff where applicable, quality
metadata and D1 query metadata. Stored Feature rows must pass version, SHA and timestamp-integrity
checks before they are returned.

`/health` can expose `INTELLIGENCE_WORKER_GIT_SHA` and Cloudflare version metadata when configured.
Its annual storage projection is calculated only from returned JSON lengths and is explicitly not
total D1 database storage. Missing samples remain `INSUFFICIENT_DATA`; they are never converted to zero.

## Security and operations

- Bearer authentication uses a separate `INTELLIGENCE_READ_TOKEN`; no value is checked in.
- Only GET is accepted. Every SQL statement is fixed in source and parameter-bound.
- Responses are `no-store`, capped at 900 KB and never include credentials or raw exception text.
- The provider `INTELLIGENCE_RATE_LIMITER` binding is mandatory and fail-closed. The deployment
  template permits 60 authenticated route calls per 60 seconds per Cloudflare location and route.
  A secondary per-isolate limiter remains defense-in-depth; neither counter is described as billing-
  exact or globally consistent.
- Every D1 operation has a 5-second application deadline and the configured value is clamped to
  100–10,000 ms. A timeout returns `QUERY_TIMEOUT` and never creates a write path.
- `MARKET_HISTORY` is the only data binding. There is no GitHub token, write route, arbitrary table
  selector or SQL parameter.
- D1 does not expose a binding-level SQL permission mode in this design. Read-only behavior is
  enforced by fixed source-controlled `SELECT` statements, a mutation-keyword guard, GET-only routes,
  and the complete absence of write handlers. Candidate code deployment remains a security boundary.
- Runtime request/failure counters are explicitly labeled per-isolate. Durable failure counts require
  provider logs/analytics and must not be inferred from one Worker instance.

## Additive rollout

1. Keep the production GitHub publication path unchanged.
2. Copy `wrangler.intelligence-candidate.example.toml`, replace only the D1 database ID and deployed
   Git commit placeholders, then deploy this Worker separately.
3. Create `INTELLIGENCE_READ_TOKEN` with `wrangler secret put`; never place its value in configuration,
   source, logs, documentation or status files.
4. Validate authentication, provider rate limiting, bounds, query metadata, quality and response size
   against production D1.
5. Introduce consumers behind an opt-in; retain GitHub as the compatibility fallback.
6. Roll back by disabling/removing only this candidate route. D1 and production relay remain intact.

## Candidate validation gate

- no token and wrong token: HTTP 401 before provider rate limiting or D1;
- correct token: accepted only when the provider limiter binding is available;
- `/health`, `/state`, `/features`, bounded ticker-specific `/history`: HTTP 200 with real D1 data;
- invalid ticker/version/range/limit/future cutoff: HTTP 400;
- provider limit exceeded: HTTP 429; missing binding: HTTP 503 before D1;
- D1 failure: generic HTTP 503; query deadline: HTTP 504;
- every prepared statement observed in tests starts with `SELECT`; no arbitrary SQL endpoint exists;
- stale/null quality, Feature version and input cutoff are returned unchanged;
- production `market-relay`, bindings, publication and writers are audited independently.


## /summary — source implemented, local validation only

New code/service release3 (API schema remains1); NOT_DEPLOYED or remotely validated by this checkpoint. Historical deployed candidate remains the previously validated SHA/release, not this source.

GET /summary?maxObservationAgeMs=180000&maxFeatureAgeMs=300000 optionally accepts cutoffMs and ticker (005930/000660/ALL). Existing Bearer authentication, GET-only handling, provider+isolate rate limits, response bound and request deadline apply. Age policies are mandatory; limits are0–900000ms for observations and0–3600000ms for Features. Values in this example are request parameters, not approved portfolio or deployment defaults. Unknown/duplicate query parameters are rejected.

At most two existing bounded SELECT/LIMIT1 queries are used: state then stored Feature2. No writes, new SQL interface, migration, external snapshot fetch or private-domain module is added. Public-only projector returns source-quality codes, separate observation/Feature ages/cutoffs and unavailable Signal/portfolio/decision capabilities. No price payload or compact Feature tree is echoed.

Missing Feature yields NOT_FOUND; malformed/integrity/read failure yields generic FAILED with unavailable Feature while retaining observation. Missing failure telemetry is null, never a fabricated0. Feature read failures increment existing per-isolate failure count. State failure remains503; a waiting Feature read is bounded by existing QUERY_TIMEOUT504. Failed candidate requests can still be handled by the separate client fallback contract; this Worker does not fetch GitHub itself.

Summary generatedAtMs is actual handler time, evaluationReferenceMs is cutoffMs for explicit as-of age evaluation. Future/unavailable input cannot be promoted. release contains service version, supported Feature version and sanitized configured Worker SHA. These fields identify code only after authenticated remote validation; local tests do not certify current deployment.

Tests: new summary6 tests are covered by final full149/149 PASS. Initial related summary/read API17/17 PASS preceded the added deadline test. Native linker guard now includes actual candidate transitive dependencies and excludes all private domain modules. No current authenticated API/D1 or scheduled-consumer evidence. Source SHA256 a79b1a31ccb6ab9bd5c0b8a30f5905c9c621b77ef254d2d80f49e1aa37051c51.
