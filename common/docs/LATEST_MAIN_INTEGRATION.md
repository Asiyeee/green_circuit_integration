# 최신 통합본 연결 결과 — 2026-11-03 KST

`codex/price-platform-flow`에서 기존 `45f7693`·`857914a`를 보존하고 최신 `origin/main` **496c6ca988ed645aa58e9f5eafa63942e51eacc6**을 병합했습니다. 통합 전 작업 트리는 깨끗했으며 별도 `green-circuit-before-latest-main.bundle`도 준비했습니다. main 브랜치 수정·병합·push, 배포, PR #1 병합, 카톡 전송은 수행하지 않았습니다. 최종 커밋·push·bundle 해시는 별도 전달용 완료 보고서와 Git 로그에서 확인합니다.

## 팀 기능 보존과 동작 조정

| 영역 | 보존·연결한 동작 | 조정한 이유 |
|---|---|---|
| 석훈님 AI 시세 추정 | `price-estimate.js`, 프롬프트/스키마, `no_data` 조합에 대한 같은 기종/제조사 행 근거 추정 | 원문 가격 자료가 없다는 사실과 근거 행/URL/확인일/불확실성을 별도로 저장·표시. 업체 CSV에 AI 값을 쓰지 않음 |
| 기능 고장 AI 감가 | `fault-adjust.js`, 프롬프트/스키마, `seller-routes.js`의 공통 `priceOf`를 조회/발급에 함께 사용 | 사용자 증상, AI 해석, AI 감가 추정, 감가 전 기준가, 감가 후 참고가, 판매 희망가를 분리. 수리비 검증/기기 직접 진단으로 표현하지 않음 |
| 중복 감가 차단 | 파손·잔상·화면 불량·혼합 고장 기준에 추가 AI 차감 생략 | 해당 기준에 이미 포함된 손상의 범위를 입증할 수 없어 보수적으로 유지. clean/minor_wear/visible_wear 기준에서만 별도 기능 고장 감가. 사유도 표시 |
| 업체 견적 목록 | 업체별 원래 등급·조건·원문 금액·기준일·수집 시각·URL 유지 | AI 감가 시 목록은 감가 전 업체 기준 견적임을 표시. 단일/복수 업체는 실제 업체 수로 판단 |
| 외관 AI 제안 | 사용자 선택과 AI 제안을 모두 보존, 불일치 안내와 적용 버튼 | 자동 선택하지 않음. 분석 후 사용자가 선택을 바꿔도 안내 재계산. 사진 변경/실패 시 이전 판별 ID 해제, 다른 모델 판별 ID 재사용 차단 |
| 기능 모름/실패 처리 | unknown 보존, 키/근거 부족·호출 실패 시 수동 상태·희망가·등록 가능 | 정상 기능 전제 조합은 자료가 없더라도 unknown을 정상으로 가정해 AI 추정하지 않음. 실패/잘못된 숫자 결과는 가격으로 수용하지 않음 |
| 캐시 | CSV 내용 해시·모델·프롬프트 해시로 추정/감가 캐시 구분, 크기 제한 | 금액이 같은 출처/조건 갱신도 캐시 무효화. 처리 도중 데이터가 바뀌면 오래된 AI 결과 폐기. 실패 결과는 재시도 가능 |
| 처리 안내 | 판매/기부/배출 선택별 매뉴얼과 환경 온도 미리보기, 완료 후 안내 | 기존 매물별 관리키·소유권 검사·명시적 완료 확인 유지. 방법 선택/안내 열람/요청 확인은 판매 완료가 아님 |
| 플랫폼 판매 | 등록→구매자 목록/추천→문의/거래 요청→판매자 확인→명시적 판매 완료 유지 | 파손·낮은 금액·자료 없음으로 외부 업체 매입/기부만 강제하지 않음. 가격 점수 제외 유지 |

가격 결과는 기존 `status: ok` 인터페이스를 유지하며 `sourceKind`, `estimated`, `faultAdjusted`, `originalLookup`, `datasetRevision`, `evidenceRows`, `basePrice`, `sellerFaultDetail_ko`, `deduction`을 추가합니다. `status`만으로 검증된 업체 가격이라고 해석하지 마세요. 업체 원문은 `sourceKind: vendor_reference`, AI 추정은 `ai_estimate`, AI 감가는 `ai_fault_adjusted`입니다. AI 감가의 `quotes`는 실제 감가 후 업체 제안이 아닌 원래 기준 견적입니다. 보증서에는 발급 당시 결과를 보존하며 갱신 후 재작성하지 않습니다.

## Git 충돌 해결

10개 파일에서 실제 충돌을 해결했습니다. 이전 파일 전체로 덮어쓰지 않고 양쪽 변경을 연결했습니다.

| 충돌 파일 | 해결 |
|---|---|
| `package.json` | 일별 수집·검색 명령과 기존 회귀 테스트 유지 + 추정/감가 자체 점검 추가 |
| `part2_price_disposal/README.md` | 실제 원문 조회의 no_data와 별도 AI 추정 정책 구분 |
| `part2_price_disposal/lib/assessment.js` | 새 고장 재분류·AI 결과 설명 보존, 플랫폼 판매 기본 추천·기부/배출 대안 유지 |
| `part2_price_disposal/lib/price.js` | 최신 main의 `allRows`/`appliedCode`와 원문 견적 재분류를 기존 검증/핫 리로드/수집 메타데이터에 연결 |
| `part3_certificate/lib/seller-routes.js` | 새 `priceOf`를 조회·발급에 공통 적용, 거래·소유권·검색/상태 API 유지. 같은 URL의 두 매뉴얼 라우트가 서로 가리던 문제 해결 |
| `part3_certificate/lib/certificate.js` | 사용자 고장 설명·AI 가격 사실 추가 + 미확인 상태·기존 무결성 해시 호환 유지 |
| `part3_certificate/prompts/certificate-summary.system.md` | AI 추정/감가 문구와 기존 검증 한계 동시 반영 |
| `part3_certificate/seller.html` | AI 분기·입력 경합 대응 + 희망가/관리키/플랫폼 등록 보존 |
| `part3_certificate/certificate.html` | AI 기준가/감가와 원문 견적 표시 연결, 소유권 없는 완료 UI를 복원하지 않고 기존 소유권 확인 UI에 새 매뉴얼 미리보기 연결 |
| `part4_buyer/buyer.html` | 희망가/기능 모름/가격 점수 제외 보존, AI 추정에 ‘업체 0곳 가격’처럼 표시하던 혼동 제거 |

## 호준님 하드웨어 결과

`part1_hardware_test/COMMON_CHANGES.md`와 최신 sample을 확인했습니다. **part1 전체는 origin/main과 동일**하며 별도로 재수정하지 않았습니다. `common/result.schema.json`도 변경하지 않았습니다.

이전 12칸 결과와 새 98칸 결과를 모두 저장·발급·구매자 변환·추천에서 검증했습니다. 터치 154칸의 미완료 예도 검증했습니다. 터치는 실제 `cellsTotal`/`cellsHit`를 읽습니다. 마이크 quality/SNR/노이즈 게이트, 스피커 횟수·음역대 status, 터치 도달률·미도달, 카메라 저조도/촬영 코칭을 보증서에 추가 보존합니다. 미지원·실패·미완료는 원래 상태를 유지하며 요약의 completed/allPassed가 항목 상태와 다르면 항목 상태를 기준으로 표시합니다.

측정 등급·저조도 미측정·촬영 사진 화질을 전체 기기/외관 등급이나 기능 고장·정액 감가로 변환하지 않습니다. 실제 모바일 센서 측정 정확도는 이번 통합 테스트로 검증하지 않았습니다.

## 시작 화면 PR #1

[아시예님 PR #1](https://github.com/gnstjr83/green_circuit_integration/pull/1)은 확인 시점 **open / merged:false**였습니다. head `b413803faac006180e8bb81dbc1048351fc0f23e`, PR base `88aabce`이며 현재 origin/main은 `496c6ca`입니다. 임의로 병합하거나 파일을 가져오지 않았습니다.

변경 파일은 `common/home.html`, 로고 SVG 2개, `common/assets/nav.js`, `common/assets/ui.css`, `server.js`의 6개입니다. 우리 브랜치는 ui.css/nav.js를 수정하지 않았고, server.js는 로컬 통합 검증용 Gemini 의존성 주입 부분을 수정했습니다. PR의 `/start`·`/home` 라우트 추가는 다른 위치이므로 확인한 diff 기준 직접 같은 줄 충돌은 예상되지 않습니다. 이는 diff 검토 결과이며 PR 병합 실행 결과는 아닙니다.

향후 연결점: `/`는 하드웨어 검사, `/seller`는 추가 입력·플랫폼 등록, `/buyer`는 구매자 목록입니다. 시작 화면의 판매자 링크는 현재 설계대로 `/?t=...`로 검사부터 시작합니다. nav/home은 localStorage의 `gc-token`과 URL 토큰을 유지해야 합니다. 매물 관리키를 링크에 넣으면 안 됩니다. `--eco` 토큰·로고는 지금 브랜치에 아직 포함하지 않았습니다. 시작 화면의 ‘자동 점검’ 문구는 사용자 확인이 필요한 항목까지 자동 진단으로 읽히지 않도록 팀 검토 지점으로 기록합니다.

## 실행 검증과 한계

- Node **24.22.1**, 공식 npm **12.2.1** 환경에서 `npm ci` 성공. 기존 잠금 의존성의 moderate 취약점 6개와 npm이 막은 2개 의존성 설치 스크립트를 기록했으며 임의 버전 변경/스크립트 허용은 하지 않았습니다. 실제 Firestore/Cloud 호출 검증으로 계산하지 않았습니다.

이 PC에서는 앞서 검증한 공식 portable npm을 현재 PowerShell 프로세스 PATH에만 추가해 실행했습니다. 전역 설정은 변경하지 않았습니다. 일반 Node/npm이 설치된 다른 PC에서는 PATH 줄 없이 실행합니다.

```powershell
# 저장소 폴더에서, 이 PC의 portable npm을 사용할 때만
$env:PATH = (Resolve-Path ..\tooling\bin).Path + ';' + $env:PATH
npm ci
npm test
npm run validate -- part1_hardware_test/sample-result.json
npm run validate -- tests/fixtures/hardware-v1-before-2026-11-03.json
npm run price:validate
npm run price:status
npm start
# 공개 출처 후보 수집만 실행 (기존 CSV는 유지)
npm run price:collect -- --vendors=phonesam --models=iphone17e --limit=1
# 기존 실제 수집 기록으로 서버 무재시작 갱신 재생 검증
node part2_price_disposal/scripts/verify-collected-snapshot.js part2_price_disposal/data/refresh-staging/runs/2026-11-02T18-26-22-746Z-7548
```

마지막 명령의 run 폴더는 git에 없는 공개 원문 증빙이며 전달용 아카이브에서 복원할 수 있습니다. npm start는 서버를 계속 실행하므로 나머지 명령은 다른 터미널에서 실행하거나 서버 종료 후 실행합니다.

- `npm test`: **27개 통과 + 원래/추가 자체 점검 4개**. 이전/새 JSON, 미지원/실패/미완료, 원문/AI 가격 분리, 근거/금액 검증, 중복 감가, 캐시 갱신·처리 중 변경·실패 재시도, 거래/소유권, 수집/원자적 갱신/보존 포함.
- `npm run validate -- part1_hardware_test/sample-result.json`, 이전 JSON fixture validate, `npm run summary -- part1_hardware_test/sample-result.json`, `npm run price:validate` 성공. 가격 데이터 **1,784행·2,841견적 유지**, 통합 CSV 해시 `fefb516e6eef6a02c70de78347f65ec767ff6e12a5a5fedbe1b968fd824148b3` 유지.
- 실제 공개 폰삼 iPhone 17e를 다시 수집: run `2026-11-03T04-41-21-113Z-15496` (KST 13:41). 1페이지 수집/파싱, 검증 가능 6견적·제외 2견적, 수집 오류 0. **후보만 생성**, 실제 금액 변경 0, 부분 결과로 기존 CSV를 덮지 않음. 이전 2,835견적 유지. 다른 업체를 이번에 전량 재수집했다고 보고하지 않습니다.
- 기존 실제 수집 run `2026-11-02T18-26-22-746Z-7548`의 원자료→후보 해시 재현 및 실행 중 서버 검증 성공. iPhone 17e 256GB clean **520,000~607,000 → 470,000~607,000원**, 서버 재시작 없음, 이전 보증서 보존·새 보증서 갱신·오염 스냅샷 거부 확인. 이는 이전 실수집 결과의 재생 검증입니다.
- Headless Chrome **1280/390px**에서 이전/새 결과 업로드, 업체 참고가/AI 감가/AI 추정 표시, 별도 구매자 요청, 판매자 확인, 선택별 매뉴얼, 명시적 완료, 완료 매물 제외 확인. 기능 모름·불일치 적용 버튼·가로 넘침 없음 확인, pageerror 0. QR CDN 라이브러리는 대역이며 실제 QR 생성 검증으로 계산하지 않습니다.
- AI 관련 자동/브라우저 검증은 **Gemini 대역**입니다. 프로세스·사용자·시스템의 관련 키 설정과 기본 ADC 존재 여부를 값 노출 없이 확인했으나 모두 없었습니다. 실제 Gemini 추정·감가·외관 분석·검색 호출은 미검증입니다.
- 사진 제안 UX는 직접 생성한 1px PNG와 대역으로 검증했습니다. 사용 권한과 개인정보가 확인된 실제 파손 사진이 없으므로 실제 사진 판별 정확도는 미검증입니다. 실제 매입 거래도 없어 표시 가격의 실제 매입 정확성은 검증하지 않았습니다.
- Cloud Run/Firestore/Storage의 실제 운영, 일별 예약 가동은 미검증/미가동입니다. 설정 준비와 로컬 실행은 기존대로 보존했으며 원격 배포·클라우드 설정 변경을 하지 않았습니다.

브라우저와 가격 검증 요약: `integration-verification.json`. 전달용 원문 증빙 아카이브에는 기존 5개 수집 실행과 이번 후보 수집 실행을 포함합니다. 테스트 fixture `tests/fixtures/hardware-v1-before-2026-11-03.json`은 기존 `857914a`의 팀 제공 sample을 그대로 보존한 것입니다.
