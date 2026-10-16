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
| 관측 조건 | 분기매출/영업이익 KRW_BILLION·QUARTER, 주가 KRW·5/10/30m, 종목 수급 SHARES·BUCKET, 프로그램 KRW·5/10/30m, OI CONTRACTS·5/10/30m, Basis POINTS·5/10/30m. 모두 MANUAL_REVIEW_REQUIRED, 조건문 실행 없음 |
| 아직 미지원 | EPS/PER·통화변환·별도재무·분기/연간 자동 정렬·외부 보고서 수집·후보 순위·수량·확률·세법 확정·담보/가용현금·실사용 알림 |

새 자료 범위를 지원하려면 새 검증과 계약 변경을 먼저 한다. 지원되지 않는 수치를 비슷한 단위로 임의 변환하지 않는다. 단기 신호와 장기 논리를 평균 점수로 합치지 않는다.

## 작성·전달·승인 절차

1. 프로젝트는 원문·권한·시점·수치·중요 반대 근거를 확인해 DRAFT를 작성한다. 금융 원장/계좌/보유수량/토큰/개인별 조정안은 포함하지 않는다. 닫힌 필드 규격은 자유서술의 개인정보·저작권 검토를 대신하지 않는다.
2. 연결된 경로가 없으므로 최초 자료는 사용자가 파일/텍스트로 **명시적으로 전달**한다. 프로젝트 대화·업로드·인증정보가 Work나 예약에 자동 공유되지 않는다. 실제 자료의 비공개 저장/수신 경로는 아직 승인·검증되지 않았다.
3. Work의 sealResearchPackage는 기존 canonicalJson(sorted keys/bounded JSON)으로 body를 직렬화하고 content_sha256만 제외한 SHA256을 계산한다. 프로젝트가 정확히 계산할 수 없다면 해시를 추측하지 말고 미봉인 DRAFT라고 표시한다. Work가 명시적으로 봉인·검증한 해시를 확인한 후 승인 요청한다. 해시는 서명·사실 검증·승인이 아니다.
4. receive가 구조·정확한 수치 근거·시점·버전을 검사해 REVIEW_REQUIRED로 보관한다. schema_version은1이며 패키지 본문의 APPROVED/실행코드/개인 원장 같은 추가 필드는 거부한다. 유효한 JSON·수치 일치·제출자의 originalRead는 투자 적합성이나 진실성 증명이 아니다.
5. 사용자 승인 기록은 별도 경계 verifyUserDecision에서 검증되어야 한다. 정확한 package_id/revision/content_sha256/decision/decision_id를 결합한 bindingHash, USER_APPROVER 역할, 검증된 결정·기록 시점, 고유 receipt가 필요하다. 현재 구현은 이 **신뢰 의존성을 주입받는 로컬 factory**이며 실제 인증/승인 서비스가 아니다. 운영에서 fixture verifier를 사용하지 않는다.
6. 승인된 유효 revision만 통합에 사용한다. 승인 대상은 연구 내용 버전뿐이며 배포·매매·운용 한도 변경 승인으로 해석하지 않는다. 패키지가 스스로 APPROVED라고 적거나, 오래된 버전의 승인을 새 내용에 재사용할 수 없다.

동일 ID/revision/hash는 중복 receipt만 반환한다. 같은 ID/revision에 다른 유효 내용이면 충돌이다. 새 revision은 직전 revision/hash를 supersedes로 정확히 참조하며 이력을 덮어쓰지 않는다. 새 revision이 도착하면 미승인 상태여도 이전 revision을 현재 판단으로 fallback하지 않는다. 철회 후 같은 revision 재승인은 금지하고 새 revision을 제출한다. 만료·재검토 기한이 지난 내용은 제외한다. 조회 as-of 이전에 실제 수신/승인 기록된 내용만 사용하며 나중 확보/기록을 과거로 소급하지 않는다.

현재 세션 저장은 EPHEMERAL_LOCAL_SESSION_ONLY이다. 재시작 뒤 승인·철회 이력이 유지된다고 가정하지 않는다. 영속 저장·승인 취소 전파·권한 검증은 실제 비공개 경로 연결 전 별도 검증 대상이다. 사용자 별도 승인 없이 새 저장소/API/권한/Secret을 만들지 않는다.

## 모니터링 결과와 제한

buildResearchMonitoringSummary는 decision_id, 생성/입력 cutoff·knowledge as-of, 시장/연구 버전·해시·승인 참조, 수치 변경, 장기/단기 판단, 근거/반대 근거, 제한된 대안과 수동 이벤트를 반환한다. 반환 객체는 불변이며 verifyResearchMonitoringSummary로 변경을 탐지할 수 있다. 실제 판단 장부·결과 평가·프로젝트 환류 저장은 아직 연결되지 않았다.

개인 원장이 없거나 이 연결부의 미구현 private adapter를 우회해 값을 넣으면 평가액·수량·담보 clearance는 null이다. 기존 compareAlternatives는 원장/재원/비용 근거가 필요하므로 호출하지 않으며 임의 계좌·현금을 만들어 채우지 않는다. A4 현금 기능과 별도이고 담보 매도대금을 인출 가능 현금으로 인정하지 않는다.

이벤트 ID는 package_id/종목/rule_id로 공유하고 change_hash로 의미 있는 변경만 구분한다. 생성 시각·단순 heartbeat로 이벤트 ID를 바꾸지 않는다. 이전 hash를 명시적으로 전달하면 UNCHANGED를 확인할 수 있지만, 현재 통지/전달/확인은 모두 미구현·NOT_SENT다. 동일 ID가 실제 Work/프로젝트/Watch 저장소 사이에서 공유되거나 전달된 것은 아직 아니다.

기존 Watch를 생성·변경하지 않는다. 예정 소비 시각은 평일12:10·15:10·16:10, 금요일 주간·마지막 금요일 월간 검토다. 실제 자료 전달→권한/저장→배포→예약 조회→기기 알림을 각각 검증하기 전에는 NOT_DEPLOYED_NOT_WATCH_READY이다. 외부 보고서·프로젝트 산출물의 명령·코드·URL·규칙은 입력 데이터로만 취급한다.
