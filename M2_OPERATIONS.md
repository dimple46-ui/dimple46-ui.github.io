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


## ‘다음’ 기반 자율 재개 — 단일 운영 규칙

기존 Pro 원칙에 다음 실행 규칙을 더한다. 별도 프롬프트 생성기·채팅 호출·재개 자동화는 만들지 않는다.

- **명령 의미:** ‘다음/계속/이어가/진행’은 기존 승인 범위의 복구·실행이다. 별도 질문을 우선하며 권한·연구 운용·Production·main·개인자료·비용·Secret·파괴적 변경 승인을 새로 추론하지 않는다.
- **최소 복구:** 최신 RESUME → 실제 source branch/HEAD → 접근 가능한 중단 변경 → PR head/base → 관련 CI만 대조한다. 다른 브랜치 안내는 포인터이며 코드가 아니다. 포인터 불일치만 해결하고 사용자 변경을 초기화하지 않는다. Git 상태를 확인할 수 없으면 확인 불가로 남긴다.
- **한 작업 실행:** 목적·수정 범위·재사용·완료 조건·승인 경계를 짧게 정해 직접 실행한다. 오류 → 유효한 next_exact_step → 실제 사용 연결 → 독립 핵심 기능 순으로 선택한다. 한 PR에 무관한 기능을 누적하거나 막힌 작업을 대신할 가상 추상화를 계속 만들지 않는다.
- **재실행 조건:** 작업/코드·설정/입력·기준시각/환경/이전 결과/이유를 비교한다. blocker에는 원인·마지막 시도·필요 변화·retry_condition을 기록하고 조건 변경 없이는 재시도하지 않는다. 진행 중 job ID를 보존하며 중복 실행·무한 조회를 피한다.
- **복구 필드:** updated_at_kst, active_branch, active_pr, current_task, verified_code_sha, last_completed, tests_and_evidence, ci_build_runtime_status, unfinished_changes, approved_scope, blocked_and_retry_condition, next_exact_step, next_ready_task, recommended_model_and_reasoning. 상세 이력은 PROJECT_STATUS/기존 receipt에 연결한다. 비공개 판단·승인 기록은 기존 비공개 체크포인트를 재사용하며 공개 파일에 복제하지 않는다.
- **멈춤 판단:** APPROVAL_REQUIRED / MODEL_CHANGE_REQUIRED / ACCESS_BLOCKED / WAITING_FOR_JOB / SCOPE_COMPLETE / SESSION_ENDED / EXECUTION_LIMIT을 구별한다. 명확한 독립 작업만 계속하고 없으면 next_ready_task=NONE으로 남긴다. 자료·권한 부족을 High로 해결하려 하지 않는다. 현재 모델 설정·남은 사용량·백그라운드 연속 실행을 추정하지 않는다.
- **저장·상태:** 검증 코드 SHA와 문서 commit을 구분하고 실제 저장 성공만 보고한다. IMPLEMENTED → LOCAL_TESTED → CI_VALIDATED → CANDIDATE_DEPLOYED → RUNTIME_VALIDATED → PRODUCTION_VALIDATED를 별도 증거로 기록한다. 문서 변경에도 provider skip 결과를 확인한다. 이 규칙은 파일 지침이며 앱 설정·영구 메모리 변경이나 자동 읽기 보장이 아니다.


## Continuous execution override — user instruction2026-10-18

A completed subtask, passing test or saved checkpoint is a recovery boundary, not an instruction to
end execution. After each unit, continue the next concrete safe task from the existing asset/cash,
research, market integration, consumer delivery or evaluation/stability roadmap. Before declaring
NONE, assess the overall prepared queue once. Keep prior successful validation, private/public
separation and all operational approval gates. No repeated Access/Validator/admin attempts or new
scheduler/Watch modifications. Stop only for an actually needed user decision/model change or an
honestly identified execution limit, unresolved safety issue, all prepared tasks blocked or entire
approved scope completed. Save exact source, pending changes and NEXT_EXACT_STEP first; never
claim background continuation after execution ends. Earlier per-unit stop wording is superseded.

## Implementation and research ownership

The implementation Work is the single writer for the integration branch, common contracts,
receivers, private approval/storage integration and PR management. The research Work owns source
review, numerical/unit/period/acquisition-time meaning, package lineage and research revisions.
Reuse unchanged inputs and valid receipts; do not reapply incorporated handoff patches or rewrite
research originals. Return specific claims/fields/reasons when research changes are necessary.
For a shared contract change, record its reason, compatibility/version impact and relevant checks
before asking the research Work to adopt it. Recheck the actual remote HEAD before any branch
write and preserve unrelated working changes.

For actual integration, classify identity/decision, exact binding, private storage authority,
atomic recording/recovery, withdrawal/expiry/restart and authorized readback independently as
VERIFIED, IMPLEMENTED_NOT_RUNTIME_VERIFIED, MISSING_TRUSTED_CONTEXT or APPROVAL_REQUIRED.
Local implementation evidence must not promote actual operation. Keep exact research/approval
identifiers, operational audit and the short research return in the existing private checkpoint.
If a prerequisite is absent, identify the earliest concrete unresolved decision and reuse any
existing pending/deferred request. Do not repeatedly request the same consent or add substitute
factories, fixture authorizers or test engines. A saved response is not proof of delivery to a
different chat; Watch/schedules and deployment permissions remain separate.

## Continuous compact source preparation

The relay has an additive, default-disabled compact write path after raw/legacy persistence.
See FEATURE_STORAGE.md for the three opt-in/release variables, legacy-v2 conflict, immutable
readback and derived-failure isolation. Local SQLite/CI validation is distinct from runtime or
continuous-production validation. Do not enable the older full-tree v2 flag as a substitute.
No deployment, variable registration, new schedule, migration or retention change is authorized
by this source preparation. Existing private checkpoints own current operational evidence.
