# 실제 시세 수집·일별 실행·검색 운영 인계

2026-11-03 KST에 공개 출처 수집 → 원자료 보관 → 조건 검증 → 기존 상태별 참고가 재집계 → 로컬 CSV 반영 → 실행 중 서버 반영까지 수행했습니다. **예약 가동·클라우드 배포는 하지 않았습니다.** 조회 화면은 마지막 검증 스냅샷을 읽으며 실시간 업체 견적을 보장하지 않습니다.

## 실제 실행 결과

기존 **1,784행 / 업체 견적 2,841건을 모두 보존**했습니다. 2,737견적을 실제 공개 출처로 갱신했고 104견적은 확인되지 않아 이전 값을 유지했습니다. 작업 시작 커밋 `45f7693`과 비교해 949견적의 금액, 741행의 참고 범위가 바뀌었습니다. 기존 조회 키·원래 등급 연결·기능 조건·업체 수는 유지했습니다.

| 업체 | 실제 수집 경로 | 기존 견적 갱신/보존 | 제한 |
|---|---|---:|---|
| 폰삼 | 기존 145개 모델 URL의 용량×등급 HTML 표 | 1,396 / 20 | M36 점프4의 상태 선택 문의/표 숫자 충돌, `아이폰 17 에어`와 서비스 `iPhone Air`의 정확한 연결 미확정 |
| 리템즈 | 기존 63개 모델 URL의 용량×그룹 표·등급 기준 | 556 / 0 | 연도 없는 `11월 1일`은 연도를 추정하지 않고 보존 |
| Rediva | `/price`의 기존 대응 표 + `/sell/policy` 검수표 | 312 / 0 | 업체 원문 가격 기준일은 2026-10-30, 수집일과 구분 |
| 한국스마트폰거래소 | `/kspe/price/` 제조사·모델·용량 표 | 411 / 0 | 같은 표의 iPhone 15 Pro Max 512GB 상충 원자료는 차단. 새 조회 행으로 채우지 않음 |
| 모아 | `/price` 표 + `/grade` 등급표 | 39 / 0 | `오늘 기준` 문구에 실제 날짜가 없어 날짜 미표시로 보존 |
| 유즈폰 | 기존 10개 상세 페이지의 용량×등급 표·기준 | 23 / 0 | 아이폰/갤럭시의 서로 다른 등급 조건을 각각 검토한 계약으로 확인 |
| 민팃 | 화면에서 사용하는 공개 조회 API(읽기용 POST) + 등급 API | 0 / 84 | 가격은 수집했으나 등급 조건·일부 모델명이 `??`로 손상됨. 3개 대상은 코드/용량도 미확인. 정상 가격에 반영하지 않음 |

수집하지 못한 항목을 0원·다른 모델 가격으로 대체하거나 삭제하지 않았습니다. 보존 104건은 민팃 84건과 폰삼 20건입니다. 민팃은 원문 조건이 손실되어 코드만으로 올바른 조건을 복원할 수 없고, 폰삼은 같은 페이지의 문의/표 숫자 충돌 또는 동일 모델 근거가 부족하므로 추가 추측으로 갱신하지 않았습니다.

실행 근거:

- [`data/collection-audit.json`](data/collection-audit.json): 전체 보존 검사·업체별 건수·보존 사유·실행 ID/증빙 해시.
- [`data/collection-verification.json`](data/collection-verification.json): 실제 원자료 재집계 및 서버 자동 반영 검증.
- `data/raw/collections-2026-11-03.json.gz`: 실제 실행 5회의 원자료·문서 메타데이터·실패/충돌 기록. `gunzip` 또는 Node `zlib.gunzipSync`로 읽습니다.
- `data/raw/collection-before-latest.csv.gz`: 최종 실행 직전 전체 스냅샷.
- 전체 HTTP 본문은 git 제외 `data/refresh-staging/runs/{runId}/evidence/`와 별도 전달용 evidence 압축 파일에 보관했습니다. 공개 가격 페이지이며 개인 기기 사진은 포함하지 않았습니다.

## 수집과 서비스 집계의 분리

`lib/price-sources.js`는 원래 업체 모델·용량·등급·원문 금액·조건·원문 기준일을 읽습니다. `lib/price-collection.js`는 URL·응답 시각·본문 SHA-256을 붙여 **업체 원자료**로 보관한 뒤 별도로 기존 서비스 행을 재집계합니다. 로그인·차단 우회나 판매 신청은 하지 않습니다. 민팃의 POST도 화면에서 사용하는 가격 조회만 호출합니다.

재집계 키는 업체+제조사+model_key+용량+원래 등급+출처 URL입니다. 기존 견적과 정확히 대응하는 검증 자료만 치환합니다. 원래 `conditions_ko`는 유지하고 새 원문 조건은 `source_conditions_ko`, 원문 기종/등급은 `source_model`/`source_grade`에 별도로 남깁니다. 가격만 바뀌어도 출처와 수집 시각/증빙을 보존합니다.

`data/source-contracts.json`은 기존 분류와 대조한 등급 본문의 해시입니다. 이후 조건 본문/표 구조가 바뀌면 자동 반영하지 않습니다. 알려진 조건과 맞지 않음, 빈 값/0원/문의, 용량 미상, 행/열 구조 변경, 서로 상충하는 출처는 오류 또는 제외 원자료로 남기고 해당 기존 가격을 유지합니다. SS/미개봉 등 서비스에 연결하지 않은 등급도 정상 매물 가격에 추가하지 않습니다.

표기 연결은 제한적입니다. 한글/영문 번역과 `SE 2세대`/`SE (2세대)` 등 동일 세대 표기, 리템즈의 같은 `A그룹`/`A그룹 새제품급`처럼 설명이 붙은 동일 그룹만 연결합니다. A33/A34 5G→기존 A33/A34 키는 조사 매뉴얼에 이미 명시된 두 모델만 적용하며 [삼성 공식 모델 코드 안내](https://www.samsungsvc.co.kr/solution/314621)도 대조했습니다. A52/A52 5G/A52s를 합치거나 모든 5G 접미사를 지우지 않습니다. `아이폰 17 에어`는 근거 없이 `iPhone Air`로 연결하지 않았습니다.

`checked_on`은 **그 행의 모든 업체 견적을 이번에 확인한 경우에만** 바꿉니다. 일부만 갱신되면 이전 확인일을 유지하며 견적별 `collected_at`을 표시합니다. `price_date`/`price_date_source`는 원문 가격 기준일/미표시 사유이므로 수집일로 덮어쓰지 않습니다. 실제 업체 검수 매입 결과의 정확성을 검증한 것은 아닙니다.

## 로컬 실행·상태·일별 예약

```powershell
npm ci
npm test
npm run price:validate
npm run price:collect                 # 실제 수집/재집계 후 후보 보관, 서비스 파일 미반영
npm run price:daily                   # 실제 수집/검증 후 기존 견적만 갱신
npm run price:status                  # 마지막 시도/수집 성공/반영 성공 시각, 실패, 잠금
node part2_price_disposal/scripts/price-daily.js run --vendors=phonesam,retemz --limit=1
```

기본 실행은 기존 자료에 연결된 7업체 263대상 URL을 사용하고 업체별 순차 요청(400ms 간격), 타임아웃·응답 크기 제한을 적용합니다. 다른 업체끼리만 병렬 수집합니다. 연속 3회 요청/구조 오류가 나면 그 업체의 나머지 요청을 중단합니다. 새로운 모델/미확인 용량을 추정해 수집 범위를 늘리지 않습니다.

`PRICE_JOB_DIR`(기본 `data/refresh-staging/`)의 파일 잠금으로 중복 실행을 차단합니다. 실제 CSV 승격에도 배타 잠금과 기존 SHA-256 재확인을 적용합니다. 실패는 `failures.jsonl`, 시도/성공은 `status.json`, 실행별 원자료/후보/이전 CSV/영수증은 `runs/{runId}`에 남깁니다. 일부 출처만 갱신되면 `partial_success`이며 마지막 부분 성공과 전체 성공을 혼동하지 않습니다. 실패 실행은 마지막 성공 시각을 지우지 않습니다.

프로세스 강제 종료로 잠금이 남으면 `node part2_price_disposal/scripts/price-daily.js recover-lock`을 실행합니다. 같은 호스트에서 해당 PID가 실제로 없을 때만 제거하고 실패/복구 기록을 남깁니다. 살아 있는 프로세스나 다른 호스트의 잠금은 자동 해제하지 않습니다. 서로 다른 복제 로컬 폴더를 같은 원본 파일에 연결하는 구성은 지원하지 않습니다.

Windows 예약 **구성만 생성**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File common/scripts/configure-price-task.ps1
```

현재 Windows 시간대가 Korea Standard Time일 때 매일 **09:00 KST**, 중복 `IgnoreNew`, 놓친 실행 재시도, 30분 제한의 작업 XML을 생성합니다. 실행 정책 옵션은 해당 프로세스에만 적용하며 컴퓨터 정책을 변경하지 않습니다. XML 생성/파싱을 실제 수행했고, 작업 조회 결과 `GreenCircuit-PriceDaily`는 등록되지 않았습니다. **실제 예약 가동은 하지 않았습니다.** 로그인한 사용자 세션에서만 실행하도록 준비했습니다.

운영자가 가동하기로 결정하면 같은 명령에 `-Install`을 추가합니다. 이 단계는 이번 작업에서 실행하지 않았습니다. 서버 토큰/키는 예약 인자에 넣지 않습니다. 로컬 수집 자체에는 Gemini 키가 필요 없습니다.

## 갱신 후 서버 반영

`lib/price.js`가 파일 변경을 감지하고 전체 검증 후 캐시를 교체합니다. **로컬은 재시작 없이 다음 가격 조회/발급부터 새 스냅샷을 사용**합니다. 검증 실패 시 마지막 정상 캐시와 경고를 반환합니다. 기존 발급 보증서는 발급 당시 가격·무결성 해시를 유지합니다. `GET /api/price/status`는 기존 서버 접속 토큰으로 로드 상태를 확인할 수 있습니다.

실제 최종 수집 실행을 다시 집계해 iPhone Air 1TB clean의 상한 1,000,000→998,000원을 실행 중 서버에 반영했습니다. 기존 보증서 보존·새 보증서의 갱신 가격·손상 파일 거부도 확인했습니다. 이 검증은 실제 원자료를 사용했고 실제 기기 검수/매입 정확도 테스트는 아닙니다.

```powershell
node part2_price_disposal/scripts/verify-collected-snapshot.js part2_price_disposal/data/refresh-staging/runs/실행ID
```

원자료/후보/이전 CSV가 있는 실행만 검증할 수 있습니다.

## Cloud Run 준비 범위 — 배포/실제 연결 미검증

Cloud Run의 임시 디스크를 공유 원본으로 사용하지 않습니다. `lib/price-cloud.js`에 **Cloud Storage 원본+실행 증빙 보관**, **Firestore 임대 잠금/갱신**, **GCS object generation 조건부 교체**를 구현했습니다. 로컬과 달리 여러 Job이 겹쳐도 임대 잠금과 세대 CAS로 이전 자료를 덮어쓰지 않게 합니다. 웹 서비스는 같은 GCS 원본을 최대 60초 간격으로 확인해 검증 사본을 로컬 임시 경로로 내려받습니다. 실패 시 배포 이미지/마지막 검증 사본을 유지하고 경고합니다.

준비 파일: `common/deploy/price-job.Dockerfile`, `price-job.yaml`, `price-scheduler.example.sh`. Scheduler는 **09:00 Asia/Seoul**에 Cloud Run Job 실행 API를 OAuth 서비스 계정으로 호출하도록 준비했습니다. [공식 예약 실행 문서](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule), [공식 Storage 업로드 문서](https://docs.cloud.google.com/storage/docs/uploading-objects-from-memory)를 확인했습니다.

필요한 운영 설정은 실제 프로젝트 ID·이미지·버킷·Firestore 데이터베이스·Job/Scheduler/웹 서비스 계정·ADC/IAM입니다. Job에는 해당 버킷 read/create/overwrite 및 임대 문서 접근, 웹 서비스에는 해당 원본 read, Scheduler 계정에는 Job 실행 권한이 필요합니다. 템플릿의 자리표시자를 채우고 운영자가 별도로 적용해야 합니다. 최초 원본이 없을 때만 명시적으로 `PRICE_BOOTSTRAP_FROM_REPO=true`로 초기화하고 이후 false로 운영합니다. 기본값은 원본이 없으면 실패하므로 실수로 초기 자료를 원격에 덮어쓰지 않습니다.

Job: `PRICE_BUCKET`, `PRICE_OBJECT=prices/current.csv`, `PRICE_CSV_PATH=/tmp/green-circuit-prices/current.csv`, `PRICE_JOB_DIR=/tmp/green-circuit-price-job`. 웹 서비스에도 같은 버킷/객체와 쓰기 가능한 `PRICE_CSV_PATH`를 설정합니다. `node part2_price_disposal/scripts/price-daily.js run --apply --cloud`가 준비된 실행 명령입니다.

Cloud Storage SDK 8.x는 Cloud 전용 선택 의존성으로 명시했습니다. 기존 로컬 수집/판매 경로의 Node 범위를 강제로 올리지 않으며 Cloud 이미지는 Node 24를 사용합니다. Cloud 모드에서는 선택 의존성도 설치해야 하므로 `--omit=optional`을 사용하지 마세요. 실제 확인한 환경은 Node 24.22.1/npm 12.2.1입니다.

현재 GCP 자격증명/기본 ADC 파일이 없어 실제 Cloud Storage·Firestore·Cloud Run Job·Scheduler 호출/동시 실행은 하지 않았습니다. Cloud 동기화의 클라이언트 대역 회귀 테스트와 SDK 로드만 확인했습니다. Docker CLI는 있지만 `dockerDesktopLinuxEngine` named pipe가 없어 실행 중 엔진에 연결할 수 없었으므로 이미지 빌드도 미실행입니다. 원격 배포/클라우드 설정 변경은 하지 않았습니다.

## Gemini 검색 — 연결 구현, 키 없어 실제 호출 미검증

[공식 Google Search grounding REST 문서](https://ai.google.dev/gemini-api/docs/generate-content/google-search)를 확인했습니다. 사진 분석/요약과 별도 `generateContent` + `tools: [{google_search:{}}]` 호출이며 `GEMINI_SEARCH_MODEL`(기본 지원 모델 `gemini-2.5-flash`)을 사용합니다.

```powershell
npm run price:search -- --brand=Apple "--model=iPhone 12" --storage=128GB --grade=S급
# 로컬 검증 원자료만 기존 견적에 반영할 때 추가: --apply
```

서버 토큰이 필요한 `POST /api/price/search`도 연결했습니다. 본문은 `{brand, model, storage, grade}`이며 읽기 전용 검증 결과를 반환하고 분당 3회로 제한합니다. API는 CSV를 직접 바꾸지 않습니다. 검색 제안 표시 HTML/인용 메타데이터는 결과에 보존하며 임의로 렌더링하지 않습니다. CLI `--apply`는 로컬용입니다. Cloud Run에서 검색 결과를 별도로 반영하는 경로로 오해하지 마세요.

검색 쿼리·근거 chunk·인용 연결이 없으면 응답이 200이어도 채택하지 않습니다. 인용된 허용 업체의 원문을 다시 받아 업체·기종·용량·등급·숫자·조건을 대조하고, 원문 표에서 읽은 객체만 원자료로 반환합니다. 생성된 금액이 다르면 거부합니다. 기본 JSON schema 강제로 검색 근거가 누락되는 경우도 메타데이터 검사에서 막습니다. 알 수 없는 URL/사설 주소 리다이렉트는 따라가지 않습니다.

프로젝트 `.env`/`.env.txt`, 현재 프로세스와 사용자/시스템 환경변수의 **설정 여부만** 확인했고 Gemini/Google API 키가 없었습니다. 실제 호출은 하지 않았습니다. 키 부재 503, 호출 실패/429, 검색 근거 없음, 숫자 불일치, 원문 일치 분기는 테스트 대역으로 검증했습니다. 실제 키를 설정한 뒤 검색/출처 재조회 검증이 필요하며 사진 분석·보증서 요약 호출을 검색 검증으로 세지 않았습니다.

## 수동 전체 스냅샷 검토 경로

기존 `price-refresh.js validate/promote`도 유지합니다. 후보/기존 해시, 모든 출처 증빙·검토 JSON을 확인한 후 백업/교체하며, 추가로 **기존 행/업체 견적 삭제와 v1 분류 변경을 차단**합니다. 부분 수집 파일을 전체 스냅샷이라고 표시해도 기존 행이 빠지면 실패합니다. 자동 수집은 별도 증분 병합 경로를 사용합니다.
