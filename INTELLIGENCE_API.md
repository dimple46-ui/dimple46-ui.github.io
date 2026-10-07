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
