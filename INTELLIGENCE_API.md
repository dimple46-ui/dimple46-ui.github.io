# Read-only intelligence API candidate

Status: local candidate only. It is not deployed and does not replace the production relay or the
GitHub `market-live.json` fallback.

## Purpose

Provide a bounded, authenticated route from ChatGPT-style commands such as `current situation`,
`short term` and `scenario` to the immutable D1 observation and compact Feature v2 records. The API
does not accept SQL, does not mutate D1, and does not expose Worker secrets.

## Routes

| Route | Fixed data access | Limits |
| --- | --- | --- |
| `GET /health` | Latest observation, latest Feature v2 run, five-day JSON growth summary | Four fixed SELECT queries |
| `GET /state?cutoffMs=` | Latest observation available at or before the cutoff | One row |
| `GET /features?featureVersion=2&slotMs=&cutoffMs=` | Latest or exact immutable compact Feature v2 row | Feature version 2 only, one row |
| `GET /history?fromMs=&toMs=&limit=&cutoffMs=` | Past-only raw observations | At most 12 hours, 120 rows and 900 KB response |

Every response includes `apiSchemaVersion`, the requested input cutoff where applicable, quality
metadata and D1 query metadata. Stored Feature rows must pass version, SHA and timestamp-integrity
checks before they are returned.

## Security and operations

- Bearer authentication uses a separate `INTELLIGENCE_READ_TOKEN`; no value is checked in.
- Only GET is accepted. Every SQL statement is fixed in source and parameter-bound.
- Responses are `no-store`, capped at 900 KB and never include credentials or raw exception text.
- The candidate includes a per-isolate fixed-window limiter. It is useful as a local guard but is not
  a globally consistent production rate limit. A Cloudflare provider-level rate-limit rule is a
  deployment gate.
- `MARKET_HISTORY` is the only data binding. There is no GitHub token, write route, arbitrary table
  selector or SQL parameter.
- Runtime request/failure counters are explicitly labeled per-isolate. Durable failure counts require
  provider logs/analytics and must not be inferred from one Worker instance.

## Additive rollout

1. Keep the production GitHub publication path unchanged.
2. Deploy this Worker separately with read-only D1 access and a new token only after explicit approval.
3. Validate authentication, bounds, query metadata, quality and response size against production D1.
4. Add provider-level rate limiting and observability.
5. Introduce consumers behind an opt-in; retain GitHub as the compatibility fallback.
6. Roll back by disabling/removing only this candidate route. D1 and production relay remain intact.

