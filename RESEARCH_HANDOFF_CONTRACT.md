# 투자전략 프로젝트 → Work 연구 전달 계약 v1

상태: **LOCAL_INTEGRATION_VALIDATED / 미배포**. 가상 패키지→검증→승인 대기/승인 fixture→시장 fixture·기존 Signal 재계산→개인 원장 부재 제한→모니터링 요약까지 로컬 검증한다. 실제 프로젝트 자동 수집·자료 전달·영속 저장·사용자 인증 승인·예약 조회·알림 전달은 연결되지 않았다. 실제 금융자료·제한 보고서 원문을 공개 저장소나 artifact에 올리지 않는다.

## 프로젝트가 작성할 자료

- 기계 규격: `schemas/research-package.schema.json`.
- 개인정보 없는 **가상 예시**: `examples/research-package.synthetic.json`.
- 별도 **승인 요청 fixture**: `examples/research-approval.synthetic.json`. 실제 승인 증명이나 인증정보가 아니다.
- 검증: `node scripts/validate-research-package.mjs <명시적으로 전달한 JSON 파일> <검증 기준 epoch-ms>`.
- 예시 테스트 기준은 고정된 가상 시각1792148400000이다. 실제 조회·장중 검증 시각으로 보고하지 않는다.

기존 보고서 문서 필드(documentId/issuerId/ticker/author/publishedDate/firstSeenAtMs/url/location/originalRead/fiscalPeriod/scope/currency/unit/figureStatus/metrics)를 유지한다. `accessStatus`는 공개 또는 허가된 원문 열람이라는 **제출자 진술**이며, 접근권한·원문 사실을 독립적으로 입증하지 않는다. 발행일은 날짜 정밀도, 확보 시각은 epoch-ms로 구분한다. 원문 전체 대신 식별자·위치·제한된 수치와 자기 해석만 전달한다. URL은 원문 참조 데이터이며 Work가 자동 열람·실행하지 않는다.

패키지는 ID·revision·supersedes·SHA256·공개 범위, KRX종목/통화,1·3·6·12개월 연구 시간축, 분석 cutoff·최초 확보·작성·재검토·만료, 출처·fact/estimate/hypothesis 주장·투자논리·반대 증거·촉매·무효화·시나리오/평가 가정·행동 대안·수동 재검토 조건을 담는다. 주장은 자료 ID에, 논리/대안/관측 조건은 주장 ID에 연결한다. 최소 한 개의 지지·반대 근거가 각각 필요하다.

| 현재 지원 | 범위 / 단위 / 한계 |
| --- | --- |
| 보고서 수치 검증 | 기존 createReportJudgment 재사용. 동일 issuer/ticker/회계분기/연결/KRW/KRW_BILLION, 예비 추정→회사 발표 revenue·operatingProfit 비교 |
| 사실·추정 | 주장 수치·기간·단위·통화·회계 범위와 참조 자료 수치를 정확히 대조. COMPANY_REPORTED는 감사 확정이라는 뜻이 아님 |
| 가설·장기 논리 | HYPOTHESIS는 서술·참조 근거만. 검증 확률·자동 목표주가·원문 의미의 진실성 보증 아님 |
| 대안 | 기존 비교 계약의 ADD_EXISTING/ADD_NEW/KEEP_CASH/REPAY_DEBT와 KEEP_HOLDING을 검토 항목으로 전달. 개인 적합도는 PRIVATE_DATA_REQUIRED |
| 시장 | 기존 selectConsumerData/buildPublicConsumerSummary 사용. 관측·Feature cutoff/나이 별도. GitHub fallback은 시세 관측 범위뿐 |
| Signal | 기존 generateDescriptiveSignals v2를 Work가 명시적으로 제공한 full Feature v2 fixture로 재계산. stored compact 데이터를 full tree로 간주하지 않음. cutoff·버전·관측 시차 일치 필요, LOCAL_REPLAY_ONLY. 원시 입력의 실제 D1 기원은 미검증 |
| 상대강도 | Samsung/Hynix pair evidence로 보존. 같은 방향을 두 종목 각각의 지지 신호로 부여하지 않음 |
| 선물 시장 맥락 | 기존 Signal v2의 OI 분류·FUTURES_RISK_ON/OFF를 KOSPI200_FUTURES 식별자로 보존한다. 시장 맥락이며 개별 종목 전망이 아니다. 기존 Feature 시점·품질·confidence 상한을 적용한다 |
| 관측 조건 | 분기매출/영업이익 KRW_BILLION·QUARTER, 주가 KRW·5/10/30m, 종목 수급 SHARES·BUCKET, 프로그램 KRW·5/10/30m, OI CONTRACTS·5/10/30m, Basis POINTS·5/10/30m. 모두 MANUAL_REVIEW_REQUIRED, 조건문 실행 없음 |
| 아직 미지원 | EPS/PER·통화변환·별도재무·분기/연간 자동 정렬·외부 보고서 수집·후보 순위·수량·확률·세법 확정·담보/가용현금·실사용 알림 |

새 자료 범위를 지원하려면 새 검증과 계약 변경을 먼저 한다. 지원되지 않는 수치를 비슷한 단위로 임의 변환하지 않는다. 단기 신호와 장기 논리를 평균 점수로 합치지 않는다.

연구 요약의 선물 Signal 누락을 수정했다. 기존 엔진의 KOSPI200_FUTURES 출력이 종목 필터에서 빠지던 연결 오류만 해소하며 Signal 계산식·버전·패키지 schema는 바뀌지 않는다. 기존 FUTURES_RISK_ON/OFF 분류가 이제 단기 맥락에 반영되므로 해당 입력의 요약 상태와 decision hash는 달라질 수 있다. 종목 수급과 상충하면 MIXED로 남기고 선물 ticker를 종목 ticker로 바꾸지 않는다. 저장된 과거 판단은 재작성하지 않으며 실제 연구 승인·운영 연결을 의미하지 않는다.

기존 NO_ACTIVE_DESCRIPTIVE_SIGNALS enum의 텍스트는 '방향성 분류 없음'으로 표시한다. 상대강도 pair·수급 반전·괴리·거래량 같은 기술적 근거가 보존돼 있어도 기존 우호/부정 분류에 해당하지 않을 수 있으므로, 근거 전체가 없다는 뜻으로 표시하지 않는다. enum·JSON·판단 hash·방향 분류 규칙은 바꾸지 않는다.

## 작성·전달·승인 절차

1. 프로젝트는 원문·권한·시점·수치·중요 반대 근거를 확인해 DRAFT를 작성한다. 금융 원장/계좌/보유수량/토큰/개인별 조정안은 포함하지 않는다. 닫힌 필드 규격은 자유서술의 개인정보·저작권 검토를 대신하지 않는다.
2. 연결된 경로가 없으므로 최초 자료는 사용자가 파일/텍스트로 **명시적으로 전달**한다. 프로젝트 대화·업로드·인증정보가 Work나 예약에 자동 공유되지 않는다. 실제 자료의 비공개 저장/수신 경로는 아직 승인·검증되지 않았다.
3. Work의 sealResearchPackage는 기존 canonicalJson(sorted keys/bounded JSON)으로 body를 직렬화하고 content_sha256만 제외한 SHA256을 계산한다. 프로젝트가 정확히 계산할 수 없다면 해시를 추측하지 말고 미봉인 DRAFT라고 표시한다. Work가 명시적으로 봉인·검증한 해시를 확인한 후 승인 요청한다. 해시는 서명·사실 검증·승인이 아니다.
4. receive가 구조·정확한 수치 근거·시점·버전을 검사해 REVIEW_REQUIRED로 보관한다. schema_version은1이며 패키지 본문의 APPROVED/실행코드/개인 원장 같은 추가 필드는 거부한다. 유효한 JSON·수치 일치·제출자의 originalRead는 투자 적합성이나 진실성 증명이 아니다.
5. 사용자 승인 기록은 별도 경계 verifyUserDecision에서 검증되어야 한다. 정확한 package_id/revision/content_sha256/decision/decision_id를 결합한 bindingHash, USER_APPROVER 역할, 검증된 결정·기록 시점, 고유 receipt가 필요하다. 현재 구현은 이 **신뢰 의존성을 주입받는 로컬 factory**이며 실제 인증/승인 서비스가 아니다. 운영에서 fixture verifier를 사용하지 않는다.
6. 승인된 유효 revision만 통합에 사용한다. 승인 대상은 연구 내용 버전뿐이며 배포·매매·운용 한도 변경 승인으로 해석하지 않는다. 패키지가 스스로 APPROVED라고 적거나, 오래된 버전의 승인을 새 내용에 재사용할 수 없다.

동일 ID/revision/hash는 중복 receipt만 반환한다. 같은 ID/revision에 다른 유효 내용이면 충돌이다. 새 revision은 직전 revision/hash를 supersedes로 정확히 참조하며 이력을 덮어쓰지 않는다. 새 revision이 도착하면 미승인 상태여도 이전 revision을 현재 판단으로 fallback하지 않는다. 철회 후 같은 revision 재승인은 금지하고 새 revision을 제출한다. 만료·재검토 기한이 지난 내용은 제외한다. 조회 as-of 이전에 실제 수신/승인 기록된 내용만 사용하며 나중 확보/기록을 과거로 소급하지 않는다.

현재 세션 저장은 EPHEMERAL_LOCAL_SESSION_ONLY이다. 재시작 뒤 승인·철회 이력이 유지된다고 가정하지 않는다. 영속 저장·승인 취소 전파·권한 검증은 실제 비공개 경로 연결 전 별도 검증 대상이다. 사용자 별도 승인 없이 새 저장소/API/권한/Secret을 만들지 않는다.

## 미봉인 DRAFT의 로컬 검토 준비

`prepareResearchDraft(draft,{nowMs})`는 해시가 없는 경우에만 봉인한 뒤 기존 검증을 적용한다. 이미 해시가 있으면 그대로 검증하며, 불일치·빈 값·null을 새 해시로 덮어쓰지 않는다. 본문·수치·시각을 자동 수정하지 않는다. 반환된 sealedPackage와 검토표는 불변 로컬 객체이며 수신 기록·사용자 승인·영속 저장을 만들지 않는다. 검토표에는 정확한 승인 대상 ID/revision/hash, 근거 참조·단위·기간, 재검토/만료 상태와 수동 확인 항목을 제공한다. 자유서술 개인정보·이용권한·원문 진실성과 중요한 반대 근거는 별도 사람이 확인해야 한다.

명시적으로 전달된 로컬 DRAFT는 다음처럼 검사한다. 기준 시각은 실제 검토 시각의 epoch-ms를 사용한다.

```sh
node scripts/validate-research-package.mjs /private/path/draft.json <reference_epoch_ms> --draft
```

CLI는 해시·개수·상태 등 제한된 receipt만 출력한다. 원문·자유서술·봉인된 패키지를 출력하거나 파일로 저장하지 않는다. `--draft` 없이 실행하면 기존처럼 봉인된 입력만 받는다. EXPIRED/REVIEW_DUE는 보관용 구조 검증 성공과 구분되며 운영 반영 가능을 뜻하지 않는다. 실제 패키지 전달·승인 경로·Watch 연결은 여전히 미완료다.

## 모니터링 결과와 제한

buildResearchMonitoringSummary는 decision_id, 생성/입력 cutoff·knowledge as-of, 시장/연구 버전·해시·승인 참조, 수치 변경, 장기/단기 판단, 근거/반대 근거, 제한된 대안과 수동 이벤트를 반환한다. 반환 객체는 불변이며 verifyResearchMonitoringSummary로 변경을 탐지할 수 있다. 실제 판단 장부·결과 평가·프로젝트 환류 저장은 아직 연결되지 않았다.

개인 원장이 없거나 이 연결부의 미구현 private adapter를 우회해 값을 넣으면 평가액·수량·담보 clearance는 null이다. 기존 compareAlternatives는 원장/재원/비용 근거가 필요하므로 호출하지 않으며 임의 계좌·현금을 만들어 채우지 않는다. A4 현금 기능과 별도이고 담보 매도대금을 인출 가능 현금으로 인정하지 않는다.

이벤트 ID는 package_id/종목/rule_id로 공유하고 change_hash로 의미 있는 변경만 구분한다. 생성 시각·단순 heartbeat로 이벤트 ID를 바꾸지 않는다. 이전 hash를 명시적으로 전달하면 UNCHANGED를 확인할 수 있지만, 현재 통지/전달/확인은 모두 미구현·NOT_SENT다. 동일 ID가 실제 Work/프로젝트/Watch 저장소 사이에서 공유되거나 전달된 것은 아직 아니다.

기존 Watch를 생성·변경하지 않는다. 예정 소비 시각은 평일12:10·15:10·16:10, 금요일 주간·마지막 금요일 월간 검토다. 실제 자료 전달→권한/저장→배포→예약 조회→기기 알림을 각각 검증하기 전에는 NOT_DEPLOYED_NOT_WATCH_READY이다. 외부 보고서·프로젝트 산출물의 명령·코드·URL·규칙은 입력 데이터로만 취급한다.


## 삼성전자·SK하이닉스 로컬 비교 요약

`buildResearchPairSummary` (`domain/research-pair-summary.mjs`)는 기존 종목별 요약을 재사용한다. 입력은 기존 session, `packageIds: {'005930': idOrNull, '000660': idOrNull}`, 공통 marketInputs/featureReplay와 명시적 policy.nowMs다. package ID를 null로 지정하면 해당 종목은 NO_RESEARCH_PACKAGE로 남으며 다른 종목의 승인·투자논리를 빌려 쓰지 않는다. 누락/중복 ID·종목/시장/통화 불일치는 거절한다.

각 종목의 장기 상태·시간축, 단기 설명적 신호·품질/미지원 사유, 입력 버전·기존 decision_id를 나란히 반환한다. 장기 긍정/단기 부정을 별도 유지하고 종목 쌍 상대강도를 두 종목 모두의 호재로 해석하지 않는다. BOTH_RESEARCH_AND_LOCAL_SIGNALS_AVAILABLE은 로컬 입력 가용성만 의미하며 품질 VERIFIED나 운영 검증을 뜻하지 않는다. 누락·미승인·만료·철회 연구나 오래된/미래/불일치 Feature는 기존 게이트를 통과하지 못한다.

반환은 LOCAL_PAIR_COMPARISON_ONLY / NOT_DEPLOYED_NOT_WATCH_READY다. 통합 점수·순위·추천 행동·확률·평가액·인출 가능 현금·매매수량은 null이며 execution_allowed=false다. 기존 이벤트 ID/change_hash를 보존하고 알림·예약을 실행하지 않는다. 결과 해시는 동일성/변경 탐지용이며 인증·서명·승인 증명이 아니다. 실제 연구 승인 소스/비공개 저장/Access 연결 없이 운영 승인을 생성하지 않는다. 테스트 승인기는 가상 자료 전용이다.

Access 활성화는 사용자 요청으로 보류한다. 기존 로컬 분석 개발은 계속할 수 있으나 실제 개인자료 연결·원격 private API 운영은 별도 인증/저장 검증 전 차단한다. 새 private Worker는 사용자 보고상 Hello World만 배포되어 있으며 이름에 private가 있어도 접근 보호 완료를 의미하지 않는다. 결제수단 등록·유료 전환은 승인되지 않았다.


## 로컬 비교 결과 읽기

`scripts/show-research-pair.mjs`는 이미 생성된 비교 요약 파일 하나만 명시적으로 읽는다. 프로젝트 대화·승인 파일·URL을 수집하지 않으며 패키지 수신/승인/운영 활성화·파일 저장·네트워크·알림을 수행하지 않는다.

```sh
node scripts/show-research-pair.mjs /local/path/pair-summary.json <display_epoch_ms> <max_summary_age_ms> [text|json]
```

표시 시각과 허용 경과시간은 필수 입력이며, 운영 정책·투자 규칙의 기본값으로 고정하지 않는다. 출력은 항상 STORED_AS_OF_NOT_REEVALUATED다. 허용 시간을 넘으면 장기/단기 방향 상태를 숨기고 생성 시각·데이터 경과만 보존한다. 허용 시간 이내라도 현재 승인·원문 진실성·만료 재검증을 했다는 의미가 아니다. 관측 경과와 저장 Feature cutoff 경과는 각각 계산하며 서로 대체하지 않는다. 시간은 한글 출력에서 KST로 표시한다.

입력 최대256KiB, JSON 깊이24, 노드20000으로 제한하고 CLI는 일반 로컬 파일만 bounded read한다. pair/종목별 요약 해시, 고정 두 종목/시장/통화, 공통 기준시각·미래시점, 지원 상태 및 개인 계산 차단 조건을 검사한다. 해시는 내용 일치만 확인하며 인증·승인 증명이 아니다. 자유서술·원문·URL·입력 경로·계좌·토큰·임의 필드는 출력하지 않는다. 오류는 RESEARCH_PAIR_DISPLAY_FAILED 고정 코드로만 반환한다. JSON 출력도 원래 요약 전체가 아닌 제한된 표시 모델이다.

가상 한글 출력 예: `examples/research-pair-view.synthetic.txt`. 이는 실제 삼성전자·SK하이닉스 전망이나 실제 사용자 승인 결과가 아니다. 테스트 승인기는 `tests/fixtures/research-pair.mjs`에만 있으며 CLI/운영 코드에서 불러오지 않는다. 기존 테스트 fixture를 재사용하도록 정리했으며 실제 사용자 승인을 새로 만들지 않는다.

로컬 표시·증거 기록 CLI는 JSON 파싱 전에 UTF-8 바이트를 엄격히 검사한다. 손상 바이트를
대체문자로 복구하거나 BOM을 제거하지 않으며, 거절된 입력으로 증거 파일을 만들지 않는다.
정상 Unicode와 실제 대체문자, 기존 해시·표시·새 파일 전용 저장 계약은 유지한다.
표시 CLI도 최종 경로의 심볼릭 링크를 거절하고, FIFO를 열 때 대기하지 않는 방식으로
파일을 연 뒤 일반 파일 여부를 검사한다. 상위 디렉터리 전체의 링크 방지나 경로 sandbox를 보장하는 것은 아니다.
