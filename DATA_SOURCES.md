# Sources and cadence

Existing sources: Naver/Npay public market collector; KIS Open API via unchanged endpoints/TR IDs. D1 adds no market source calls. The production live Worker source is not in this repository.

Naver program data can be older than 5 minutes. Store its source time/status and exclude it from valid deltas; do not relax thresholds to conceal latency.

KIS stock estimates: existing 09:30/10:00/11:20/13:20/14:30 schedule plus five-minute publication allowance. These are discrete estimates, not continuous five-minute flows.

Index/futures exchange timestamps are not verified by the current adapters: RECENT_FETCH remains visible. D1 history preserves that limitation.

Cloudflare docs checked 2026-10-01:
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- https://developers.cloudflare.com/d1/get-started/
