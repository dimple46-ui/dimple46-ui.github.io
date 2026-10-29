# Saved public-input summary CLI

Status: locally implemented/tested; no runtime deployment, scheduled connection or data-fetch automation. Inputs must already be legally obtained public market responses. No Secret/token/private-input argument, network, SQL or storage operation is implemented.

Example using the existing September30 closed snapshot:

```sh
node scripts/summarize-public-input.mjs \\
  --snapshot tests/fixtures/closed-snapshot.json \\
  --as-of-ms 1790766007732 \\
  --max-observation-age-ms 120000 \\
  --max-feature-age-ms 300000
```

This is historical saved-input replay at2026-09-30T11:00:07.732Z, not today's snapshot or market/runtime evidence. The120000/300000 values are explicit example age policies, not automatically approved operational settings. The result is PARTIAL, GitHub observation age1000ms, Feature/Signal/portfolio/decision UNAVAILABLE. Missing historical pipeline metadata remains UNKNOWN.

Use --state /path/to/state.json and optional --features /path/to/features.json for already saved existing candidate response schemas. Optional --snapshot provides fallback when candidate observation is unusable. File input is bounded to2MiB per regular file. A supplied malformed/missing file fails the CLI before selection; a saved API error body is not a successful /state schema. To summarize only fallback after a failed request, supply just its valid saved --snapshot. This CLI does not fetch or retry failed endpoints.

All three time-policy flags are required. No implicit current time, age threshold or reference-time inference occurs. Old input evaluated at today's time may be UNAVAILABLE; it must never inherit replay freshness. Observation and Feature cutoff/age remain separate; UNVERIFIED_TIME quality is preserved. Stale stored Feature is unavailable even when observation is recent.

Exit status0 means a well-formed PARTIAL summary with an observation, not overall system health or investment-analysis success. Exit2 means a valid summary with no usable observation. Exit1 emits only PUBLIC_INPUT_OR_POLICY_INVALID on stderr; stdout stays empty, with no filename/argv/exception/raw JSON. Unknown/duplicate/private flags and known combined private payloads are rejected. Fixed public projection is not a general-purpose private-file anonymizer; never intentionally pass private documents.

Targeted5/5 PASS, including subprocess stdout/stderr, old/future input, invalid policy/path/oversize/JSON/private payloads, retained observation/Feature age and quality. Existing full132/132 integration evidence reused, not rerun or relabeled as a current137-test result. Script SHA256 aea5546587d0595bfef002057301adb16d1762938154084037119821666edd77.

No result endpoint/file is automatically published and no scheduler gains access or credentials. The existing public snapshot path remains available separately; current online capture verification is the next bounded task.
