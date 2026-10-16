# M2 operational and storage stabilization

Status: isolated read-only candidate deployed and validated; production migration is not approved.
Nothing in this document authorizes a production Worker, binding, Secret, Cron, GitHub publication
cadence or D1 retention change.

## Measured pressure

- A full relay day produced about 331 GitHub snapshot commits. At 250 trading days this projects to
  82,750 commits per year. This is repository-history pressure, not a data-loss incident.
- Compact Feature v2 measured roughly 13.8–14.0 KB per run. At 331 runs per day the JSON-only
  projection is about 4.6 MB per trading day before SQLite pages, indexes and replication overhead.
- D1 query metadata and the five latest trading-day JSON totals are exposed by the read-only
  `/health` candidate. JSON totals must never be presented as total D1 storage.
- The 2026-10-08 13:38 KST `/health` sample covered five trading days and measured an average
  `5,316,252.6` raw-observation JSON bytes/day, projecting `1,329,063,150` bytes per 250 trading days.
  This excludes SQLite pages, indexes and replication overhead and is not a provider-byte forecast.
- Compact Feature growth still has only one sampled trading day and three controlled rows
  (`44,323` JSON bytes total), so it remains `LIMITED_SAMPLE`; it must not be extrapolated as a
  continuous production-writer measurement.

## Target responsibilities

| Layer | Responsibility | Rollback/fallback |
| --- | --- | --- |
| GitHub | Code, documentation, releases and a compatibility/emergency latest snapshot | Keep current publication until all known consumers opt in and fallback tests pass |
| D1 | Immutable raw observations and compact versioned feature runs | Disable new optional writers; never rewrite or delete v1 rows during rollback |
| Read endpoint | Authenticated, bounded latest state/history/features/health | Remove only the candidate route; GitHub publication continues |
| R2 | Deferred cold archive only after measured retention pressure | No R2 account, migration or deletion is currently required |

## Additive migration gates

1. Merge code and tests without changing production deployment.
2. Deploy a separate read-only candidate only after approval, reusing the existing runtime Secret, D1 binding,
   provider-level rate limit and release metadata. D1 binding is not a SELECT-only permission;
   the application enforces GET and fixed SELECT queries.
3. Validate state equivalence against `market-live.json` at multiple live timestamps, including honest
   freshness/quality degradation and bounded D1 query cost.
4. Opt in one non-critical consumer while GitHub remains unchanged.
5. Inventory all consumers and prove fallback before proposing a reduced GitHub cadence.
6. Observe D1 page/index growth over at least 20 trading days. Use measured database bytes, not JSON
   estimates, before selecting a hot-retention window or R2 archive.
7. Any cadence, retention, archive or production binding change requires separate approval and an
   explicit rollback window.

Gate 3 passed on 2026-10-08 at multiple regular-session timestamps, including an exact 13:42:44 KST
match with one D1 row read and zero written. Gates 4–7 remain future work and are not implied by the
candidate validation.

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

## Replay validation procedure

`scripts/validate-signal-replay.mjs` accepts a locally saved authenticated Feature-validator response
and performs no network or database operation. It rejects non-read-only responses, future cutoffs,
nonzero D1 writes, confidence-ceiling violations, stale/null program signals, nondeterministic output,
and predictive/action fields. Use it for historical and next-session validation without committing the
captured response or any Bearer token:

```sh
node scripts/validate-signal-replay.mjs /path/to/replay.json --engine-sha <validated-git-sha>
```

A passing replay is `OFF_MARKET_VALIDATED` or `LIVE_INPUT_OFFLINE_SIGNAL_REPLAY` evidence according to
the capture source. It does not prove that the active candidate deployment or production writer changed.

## Isolated candidate deployment boundary

`wrangler.intelligence-candidate.example.toml` defines only the separate
`market-intelligence-read-candidate` service. It has no route to the production relay, no GitHub
credential, no scheduled trigger and no D1 mutation handler. Its provider rate limiter is mandatory;
the Worker fails closed before D1 when the binding is absent. The candidate template points only to the
existing `market-history` database and contains no token value. The Bearer token is always created as a
Cloudflare Secret and never committed.

## Remaining acceptance gates — 2026-10-14

- VERIFIED_COMPLETE: isolated candidate build, exact-SHA/authenticated read API, bounded queries and zero writes. Reuse latest RESUME receipts.
- PARTIAL: latest-state consumer migration/fallback; no consumer cutover or reduced GitHub cadence approved.
- BLOCKED: provider CPU/memory and actual D1 page/index bytes; management credential unavailable. No repeated login/token requests.
- WAITING_FOR_MEASURED_HISTORY: at least20-day database-byte samples; five-day JSON estimates are not this evidence.
- APPROVAL_REQUIRED: production transition/cadence, retention/archive and main merge. No destructive change planned.
- Validator deploy command remains independently unverified. It does not block pure-function M3 correctness work.


## 공통 운영 원칙 — Pro 최적화 (2026-10-16T20:03:42+09:00)

사용자 지정 프로젝트 운영 기준. 기존 M2/M3 이력·아키텍처·성공 자동화와 승인 경계는 유지한다.

1. **모델·추론**: 일반 개발·테스트·복구는 GPT-6.1 Sol Medium을 기본 권장한다. 복잡한 데이터 정합성·알고리즘 설계는 Sol High, 산업·기업 심층 분석과 포트폴리오 전략은 GPT-6 Astra Medium, 중요한 전략 변경·복합 위험 설계는 Astra High의 별도 검토 단위로 분리한다. 현재 실제 선택 가능한 모델·설정만 사용하며 직접 전환하지 못하면 전환했다고 주장하지 않는다. 변경이 필요한 작업만 근거·범위·완료 조건·재개 지점과 함께 저장한다.
2. **성과와 검증**: 사용량 대비 개발 성과와 의사결정 품질을 최적화한다. 작업 종류+코드/설정 버전+입력 버전/기준시각이 같고 유효한 성공 증거가 있으면 재사용한다. 코드·입력·환경이 바뀌면 위험도에 맞는 충분한 검증을 수행하며 절약을 이유로 생략하지 않는다. 관련 테스트를 먼저, 공통 모듈·통합·배포 후보에서는 필요한 전체 회귀를 수행한다. 같은 소스의 무의미한 재검사·빈 상태 커밋·계획 반복을 피한다.
3. **연속 실행**: 승인된 안전 작업은 불필요한 '다음' 요청 없이 이어간다. 한 번에 가장 가치가 높은 검증 가능한 작업 단위를 완료하고 CHECK→IMPLEMENT→TEST→VERIFY→COMMIT→CHECKPOINT 순서로 진행한다. 인증·권한·비용·실제 승인 경계에서는 해당 작업만 멈추고, 독립적인 안전 작업은 계속한다.
4. **기존 자동화**: GitHub Actions와 Cloudflare Builds의 성공 경로를 재사용한다. Worker·D1·Secret·deployer를 중복 생성하지 않는다. 인증 거부·권한 부족·동일 장애는 조건 변화 전 재시도하지 않고 BLOCKED와 retry_condition으로 격리한다. 사용자 수동 작업은 불가피할 때 정확히 한 단계만 요청한다. [skip ci]만으로 모든 provider가 건너뛴다고 가정하지 않고 실제 check 결과를 구분한다.
5. **병행 트랙**: 자산·부채·현금관리, 보유종목 투자논리, 신규 후보 비교, 단기 대응 조건, 보고서 분석, 판단 성과 검증을 기존 M2/M3 로드맵과 병행한다. 단기 관제의 완성이 장기 분석의 선행조건은 아니다. 필요한 공통 데이터·품질 의존성은 지키고 여러 엔진을 한 단위에 무리하게 구현하지 않는다.
6. **분석 품질·개인정보**: 확정 사실·추정·시나리오를 구분한다. 검증되지 않은 수량·현금·부채로 임의 계산하지 않는다. 공개 시장 데이터와 비공개 개인 자산을 분리하고 공개 코드·로그·artifact에 실제 개인자료를 저장하지 않는다. 보고서 원문·출처를 확인하며 같은 자료는 변경분만 재분석한다. null/0, STALE/LIVE, 추정/확정을 구분하고 미래 정보 누출을 금지한다. 오래된 Feature에 최신 관측 시각을 부여하지 않는다.
7. **상태·승인**: 구현, 로컬 테스트, CI, Candidate 배포, Production 검증, 실사용 가능 상태를 별도로 기록한다. synthetic/historical replay는 당일 live PASS가 아니다. Production 변경·main 병합·파괴적 D1 작업·개인 금융정보 실제 연결은 별도 승인 후 실행한다. 기존 세부 승인 경계를 축소하지 않는다.
8. **복구**: RESUME.md는 최신 완료 작업·검증 코드·배포 상태·차단/재시도 조건·next_exact_step, PROJECT_STATUS.md는 상세 이력을 유지한다. 원래 성공 증거를 보존하되 현재 코드·배포·시점의 새 PASS로 재표기하지 않는다. 문서 업데이트가 불필요한 배포를 유발하지 않도록 기존 skip/watch 경로와 실제 증거를 이용한다.
9. **간결한 보고**: 새로 완료한 결과, 검증, 투자 의사결정에 주는 효과, 남은 위험, 다음 정확한 작업, 추천 모델·추론 수준만 보고한다. 과거 완료 작업을 장황하게 반복하지 않는다.

현재 원격 관리 blocker와 실제 시장 검증 대기는 이 운영 원칙만으로 해소되거나 승인되지 않는다.
