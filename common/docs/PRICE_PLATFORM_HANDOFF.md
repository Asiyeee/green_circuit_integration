# 플랫폼 판매 흐름 인계 (2026-11-03 KST)

최신 main의 AI 추정·감가·하드웨어 변경 통합은 [최신 통합 검증 보고](LATEST_MAIN_INTEGRATION.md)를 우선 확인하세요. 아래의 업체 원문 참고가 정책과 별도 AI 추정 기능을 구분합니다.

추가 구현: 실제 7업체 공개 출처 수집·검증·증분 갱신과 서버 자동 반영을 실행했습니다. 일별 실행·로컬 예약 XML·Cloud Run 연결·별도 Gemini 검색도 준비했습니다. [시세 수집 운영 인계](../../part2_price_disposal/PRICE_REFRESH.md)와 [실행 감사 기록](../../part2_price_disposal/data/collection-audit.json)을 함께 확인하세요. 예약/클라우드 배포는 가동하지 않았으며 실제 Gemini·파손 사진은 미검증입니다.

## 구현된 흐름

웹 점검 결과 선택/업로드 → 제조사·기종·저장 용량·외관 상태·알려진 기능 이상 확인 → 업체 매입 참고가 → 판매자 희망가 → **기존 listed 보증서를 매물로 등록** → 구매자 전체 목록/성능 추천 → 상세·보증서 → 문의/거래 요청 영속 저장 → 판매자 확인 → 판매자가 실제 완료 확인 후 판매 완료 기록.

파손폰·시세 자료 없음·고장 여부 모름도 상태를 공개하고 등록할 수 있습니다. 정상 기능을 전제로 하는 가격은 기능 이상 없음 응답이 있어야 조회됩니다. 판매 희망가는 자료가 없거나 참고 범위 밖이어도 허용합니다. 새 화면은 희망가를 입력받고, 과거 API의 `askingPriceKrw: null`은 호환을 위해 유지합니다. 잘못된 숫자는 조용히 null로 바꾸지 않고 400을 반환합니다.

기부·배출은 대안 안내입니다. 열람만으로 상태를 바꾸지 않으며 판매·기부·배출 **완료 기록은 명시적 별도 동작**입니다. 완료 매물은 판매 중 목록/추천에서 제외하고 상세 보증서는 유지합니다. 문의와 판매자 확인만으로 판매 완료가 되지 않습니다. 다른 열린 화면에는 새로고침/재검색 시 반영됩니다.

## 인증과 저장소: 통합 시 반드시 확인

- **실제 계정별 인증은 미구현인 데모**입니다. 닉네임은 표시/기존 환경온도 집계용이고 신원을 인증하지 않습니다. 환경온도도 동일 닉네임이면 공유됩니다.
- 발급 API가 256bit 무작위 `ownerToken`을 한 번 반환합니다. 화면은 해당 브라우저의 `gc-owner-{id}`에 보관하고 별도 복사할 수 있게 합니다. 서버는 **비공개 별도 문서/파일**에 SHA-256만 저장합니다. 공개 JSON·목록·URL·무결성 해시에는 관리키/해시/문의 연락처가 들어가지 않습니다.
- 받은 요청 조회/확인/완료는 기존 서버 토큰과 **해당 매물** 관리키를 모두 확인합니다. 공용 토큰·같은 닉네임·다른 매물의 키만으로 변경할 수 없습니다. 키를 아는 사람은 소유자로 취급되므로 키 유출에 주의해야 합니다. 구글 로그인·실제 개인별 권한 관리가 완성됐다고 해석하면 안 됩니다.
- 구매자는 브라우저에 생성/보관한 익명 256bit 키로 요청을 생성하고 자기 요청 상태만 조회합니다. 로그인 신원 인증/연락처 검증은 없습니다. 같은 매물·익명 구매키·요청 종류는 중복 저장하지 않습니다. 문의 연락 방법은 매물 소유자와 해당 구매키 보유자에게만 반환합니다. 매물당 최대 100요청이며 공개 운영용 스팸 방지는 후속 작업입니다.
- 로컬: `store/market/{id}.json`. 단일 Node 프로세스에서 직렬화한 트랜잭션과 write-ahead journal로 요청/완료를 처리합니다. 완료 상태와 환경온도를 함께 기록하고 재시작 시 journal을 복구합니다. 여러 로컬 서버가 같은 폴더를 쓰는 구성은 지원하지 않습니다.
- Firestore: 기존 컬렉션을 유지하고 `certificateMarket`만 추가합니다. 완료 시 보증서/환경온도를 Firestore transaction으로 함께 갱신합니다. **실제 Firestore 연결은 미검증**입니다. Admin SDK 전용 데이터이므로 클라이언트 Firestore 직접 접근을 공개하지 마세요. 기존 배포의 클라이언트 rules 설정도 별도 확인해야 합니다. 활성 목록은 status 단일 필드 조회 후 만료/최신순 정리하므로 데모 규모 기준이며 매물 증가 시 페이지네이션/인덱스 설계를 추가해야 합니다.
- 키 없는 **기존 보증서는 열람/목록/추천 호환을 유지**하고 요청 접수·상태 변경은 안전하게 차단합니다. 운영자가 별도로 소유권을 확인한 뒤 아래 CLI를 실행하고 나온 키를 해당 판매자에게 비공개 전달해야 합니다. HTTP로 소유권을 자칭해 키를 받는 경로는 없습니다. 발급된 키를 잃었다고 닉네임만으로 복구하지 않습니다.

```bash
node part3_certificate/scripts/assign-owner.js 보증서ID --ownership-verified
```

`device-hw-test/v1`, `seller-certificate/v1`의 기존 필드를 삭제하지 않았습니다. 공개 보증서에 비공개 메타데이터를 추가하지 않아 과거 무결성 계산을 유지합니다. 가격 원문의 `priceDateSource`, `conditionSourceUrl`, `verificationMethod` 등은 추가 필드입니다. `quotes[].priceDate`는 새 발급부터 원문 날짜만 담고 미표시 사유는 `priceDateSource`로 분리합니다. 과거 발급 내용은 다시 쓰지 않습니다.

## API

| 요청 | 인증·효과 |
|---|---|
| `POST /api/certificates` | 서버 토큰. `{certificate, id, url, ownerToken}` 반환 |
| `GET /api/public/certificates?limit=50` | 공개. 판매 중/유효 매물만. 최대 200. 종료 기록은 상세 조회 |
| `GET /api/public/certificates/{id}` | 공개 상세·보증서, 기존 응답 유지 |
| `POST /api/public/certificates/{id}/requests` | `x-buyer-token`. `{type: inquiry 또는 trade, nickname, contact, message}`. 종료/만료 매물 409 |
| `GET /api/public/certificates/{id}/requests/mine` | `x-buyer-token`. 해당 익명 구매자의 요청만 |
| `GET /api/certificates/{id}/requests` | `x-access-token` + `x-owner-token`. 받은 요청/연락 방법 |
| `POST /api/certificates/{id}/requests/{requestId}/acknowledge` | 동일 소유자 인증. 확인 처리. 이미 확인했으면 409 |
| `POST /api/certificates/{id}/outcome` | 동일 소유자 인증. `{type: sold 또는 donated 또는 recycled}`. 이미 종료면 409 |
| `GET /api/public/manual?brand=Apple` | 공개 안내 열람. 상태 변경 없음 |

결제·에스크로·배송·실시간 채팅은 구현하지 않았습니다. 요청 저장과 판매자가 입력하는 완료 기록까지입니다.

## 가격·사진·갱신 범위

- 업체 매입 참고가와 판매 희망가를 구분하고 업체 수는 `vendorCount`로 표시합니다. 금액이 같아도 복수 업체를 1곳으로 표시하지 않습니다. 원래 등급·조건·출처·원문 날짜/미표시 사유를 확인할 수 있습니다. 검수/조건에 따라 실제 매입가가 다르며 업체 등급은 자체 대응 분류입니다.
- 업체 매입 최고가/후보 희망가 중앙값으로 개인 거래 적정가를 점수화하던 방식을 제거했습니다. 모든 매물의 가격 점수는 null, 기존 성능/환경온도 0.4/0.25를 61.5/38.5%로 재정규화합니다. 시세 없는 매물에 점수 페널티를 주지 않습니다. 환경온도 40°C 목표는 기존 임시 데모 기준입니다.
- 다섯 하드웨어 점검이 통과해도 기능 이상 `unknown`을 `none`으로 바꾸지 않습니다. RAM을 저장 용량으로 쓰지 않고, 카메라 화질을 외관/시세 등급으로 쓰지 않습니다. A52/A52 5G/A52s를 합치는 별칭을 추가하지 않았습니다.
- 외관 AI는 자동 선택 대신 판매자가 적용 버튼/수동 선택으로 확인합니다. 배터리 캡처는 선택이며 직접 측정이나 기기 일치 검증이 아닙니다. 미확인을 정상으로 간주하거나 감가율을 만들지 않습니다. Gemini 실패 시 수동 등록과 규칙 요약을 유지합니다.
- 초기 자료 비교 후 기존 조사 원자료 CSV·매뉴얼은 보존했습니다. 통합 CSV는 실제 수집 결과로 기존 1,784행과 분류를 유지하며 갱신했습니다. 이전 로컬 파일로 덮어쓰지 않았습니다.
- [갱신 정책과 실행법](../../part2_price_disposal/PRICE_REFRESH.md): 실제 공개 표 수집·원자료 보관·조건 계약/정확한 키/금액 검증·기존 견적만 치환·백업·실패 보존을 실행했습니다. 갱신 파일은 서버가 검증 후 재시작 없이 반영합니다. 일별 실행과 예약/Cloud Run 설정, 별도 Gemini 검색 연결은 구현했지만 실제 예약 가동·원격 배포는 하지 않았으며 Gemini 키가 없어 실제 검색 호출은 미검증입니다.

## 변경 파일과 다른 파트 영향

| 파일/영역 | 변경 이유·영향 |
|---|---|
| `part2_price_disposal/lib/price.js` | 원문 날짜/검증/조건 출처 추가. 정확한 키 조회 유지 |
| `part2_price_disposal/lib/assessment.js`, `prompts/assessment.system.md` | 파손·3만원·시세 없음 처분 자동 분기 제거. 플랫폼 판매/선택적 대안, 내부 기능 단정 금지 |
| `part2_price_disposal/lib/price-sources.js`, `price-collection.js`, `price-search.js`, `price-cloud.js`, `scripts/price-daily.js` 등 | 실제 공개 수집/증분 병합/검색 근거 검증/클라우드 보관·임대 잠금 연결. 원자료와 서비스 집계를 분리 |
| `part2_price_disposal/scripts/price-refresh.js`, `PRICE_REFRESH.md`, `data/collection-*.json`, `data/raw/*.gz` | 부분 수집의 전체 덮어쓰기/기존 견적 삭제 차단, 실행 증빙·실제 원자료 보존 |
| `part3_certificate/seller.html`, `certificate.html` | 우리 플랫폼 등록·희망가·업체 원문·수동 상태 확인·문의/관리 진입 |
| `part3_certificate/lib/seller-routes.js`, 새 `market.js` | 모름 보존, 매물별 관리키 발급, 요청 저장/확인, 소유권·완료 상태 검증. ②·③ 접점이므로 수정 |
| `part3_certificate/lib/certificate.js`, 요약 프롬프트 | 미확인 기능·캡처 판독·참고가 표현. 원래 v1 해시 구조 유지 |
| `part3_certificate/scripts/seed-demo.js`, 새 `assign-owner.js` | 데모 완료 처리에도 관리키 적용, 기존 매물 운영자 이관 경로 |
| `part4_buyer/buyer.html`, `lib/buyer.js`, README | 전체 매물/문의 연결과 보수적 추천, 종료 제외 |
| `common/lib/certificate-store.js`, 새 `common/assets/market.js` | 기존 보증서 구조를 유지한 비공개 요청·소유권 저장과 완료 트랜잭션, 상세 UI |
| `server.js` | 기존 테스트 주입을 유지하고 Cloud Run 시세 스냅샷 동기화를 선택적으로 연결. 기본 로컬 동작은 동일 |
| `common/scripts/*price*.ps1`, `common/deploy/price-*`, `.dockerignore`, `.gcloudignore`, `.env.example`, npm 의존성/lock | 일별 실행/예약 템플릿, Cloud Storage SDK 명시, 로컬 증빙·비밀 파일 업로드 제외. 배포/예약 등록은 미실행 |
| `tests/`, `package.json`, `.gitignore`, README/공통 인계 | 회귀·통합·브라우저 테스트, 갱신 증빙/백업 git 제외, 실행 설명 |

① 하드웨어 테스트 코드, 공통 `ui.css`, 결과 스키마, 기존 조사 원자료 CSV/매뉴얼은 수정하지 않았습니다. 통합 시세 CSV만 검증된 수집 자료로 갱신했습니다. ③ 화면/API는 수집 시각·원문 조건·시세 검색을 연결하기 위해 추가 수정했으며 기존 보증서 가격은 다시 쓰지 않습니다.

## 실행·확인

```bash
npm install
npm test
npm run price:validate
npm start
```

서버가 출력하는 `/seller?t=...` 접속 → ①의 실제 결과 파일 또는 `part1_hardware_test/sample-result.json` 업로드 → 용량/상태/고장 여부 확인 → 희망가/닉네임 입력 → 등록 → **관리키 별도 보관** → `/buyer` 목록/추천 → 상세에서 별도 구매자 브라우저로 요청 → 판매자 상세에서 받은 요청 확인 → 실제 처리를 마쳤을 때만 완료 기록.

선택적 브라우저 회귀: Playwright 패키지와 Chrome이 있는 환경에서 `node tests/browser-flow.cjs`. 이 테스트는 임시 저장소와 샘플 JSON을 쓰고 실제 사진·실제 Gemini를 호출하지 않습니다. QR CDN은 테스트에서만 빈 스크립트로 대체하므로 외부 CDN/QR 생성은 검증 범위에서 제외합니다.

## 실제 수행한 검증

기존 `assessment.js`, `buyer.js` 자체 점검과 정상 npm 환경의 통합/수집/갱신/검색 회귀 테스트 **20개**가 통과했습니다. 갱신 후 Chrome PC 1280px/모바일 390px 판매 흐름도 통과했습니다. 실제 수집 원자료 재집계와 실행 중 서버 반영·과거 보증서 보존·오염 파일 거부도 수행했습니다. 테스트 데이터는 임시 폴더에만 생성 후 정리했습니다.

초기 PATH에 npm이 없었으나 공식 npm 배포물의 무결성을 확인해 별도 로컬 도구 폴더에 준비했습니다. Node 24.22.1/npm 12.2.1에서 `npm ci`, `npm test`, `npm run price:validate`, `npm run price:status`, `npm start`와 실제 화면/API 응답을 확인했습니다. Cloud Storage를 직접 사용하므로 의존성과 npm lock을 함께 갱신했습니다. npm 기본 정책이 차단한 두 의존성 install script는 승인하지 않았으며 실제 Firestore/Cloud 실행이 검증됐다고 보고하지 않습니다.

| 사용자 완료 기준 | 실제 검증 |
|---|---|
| 1. 점검→추가입력→참고가→희망가→등록→노출→보증서 | 로컬 HTTP와 Chrome 화면에서 수행 |
| 2. 요청 저장→판매자 확인→명시적 완료→판매 목록/추천 제외 | 로컬 저장소 재로딩 + HTTP + Chrome에서 수행 |
| 3. 없는 기종/용량/상태 가격 생성 금지·등록 허용 | 정확한 키 단위 테스트, Galaxy A52/2TB 파손 상태 HTTP·화면 등록 |
| 4. 모름 유지·미확인 표시 | 5/5 통과 샘플에서도 unknown·needs_check 확인, 화면에서 none 선택 전 미확인 표시 |
| 5. 파손 등록·기부/배출 별도 선택 | 파손 HTTP/화면 등록, 안내 열람은 listed 유지, donated/recycled는 명시적 API 후 제외 |
| 6. 단일/복수 업체·희망가 구분 | 실제 CSV의 단일/복수/동일금액 복수 업체 행 검증, 범위 밖 999999원 화면 등록 |
| 7. Gemini 없거나 실패 시 수동 경로 | 키 없는 HTTP 503/화면 수동 등록, 주입한 upstream 실패의 서비스 처리/규칙 요약 확인 |
| 8. 중복 완료·권한 차단 | 동시 두 완료 요청 200/409와 온도 1회 반영, 타 매물 키/공용 토큰 단독 차단, 요청·확인 중복 차단 |
| 9. 기존 보증서/저장 호환 | 기존 sample 보증서 상세/무결성 판정 유지, 관리키 없는 기존 매물 변경 차단, 로컬 journal 복구 |

**미실행:** 실제 휴대폰 하드웨어 측정, 실제 파손 사진→Gemini 상태 제안→가격 전체 흐름, 실제 Gemini 호출/검색, 실제 Firestore/Cloud Storage·Cloud Run 연결·동시 트랜잭션, 예약 가동/운영 배포, 실제 매입 결과와 표시 가격의 오차 검증. 실제 원문 수집은 수행했습니다. 샘플 JSON/실패 주입/검색·Cloud 클라이언트 대역 테스트를 실제 파손폰/Gemini/클라우드 실행으로 계산하지 않습니다.

## main 통합 전 석훈님 확인 사항

1. 기존 UI/파트 변경과 위 API 헤더를 함께 통합하세요. 예전 공용 토큰만 보내는 완료 호출은 의도적으로 403이 됩니다. 구매자가 완료 API를 호출하면 안 됩니다.
2. 기존 매물은 소유권 확인 후 관리키를 이관하거나 데모를 다시 생성하세요. 공개 서버가 발급한 관리키를 git/로그/URL/공개 보증서에 저장하지 마세요.
3. 로컬 서버는 단일 프로세스로 운영하세요. Firestore 프로젝트의 Admin 자격증명/비공개 컬렉션 접근 설정과 실제 연결 테스트가 필요합니다.
4. 수집 코드는 실제 실행했지만 일별 예약/Cloud 운영 설정은 가동하지 않았습니다. 실제 파손 사진·실제 Gemini·Firestore/Cloud QA가 남았습니다. 실시간 견적·실제 계정 인증/결제를 제공한다고 안내하면 안 됩니다. 민팃의 깨진 조건, 폰삼의 미확정 모델/문의-표 충돌은 기존 자료를 유지합니다.
5. 작업 브랜치는 `codex/price-platform-flow`, 최초 기준 main은 `108de0a`입니다. 최신 `496c6ca`를 이 작업 브랜치로 병합했고 기존 두 커밋을 보존했습니다. main 브랜치로의 병합·push·배포는 하지 않았습니다. [최신 AI·하드웨어 통합 인계](LATEST_MAIN_INTEGRATION.md)와 전달용 완료 보고의 Git 결과를 확인하세요.

## 석훈님께 보낼 카톡 초안

석훈님, 최신 main 496c6ca를 codex/price-platform-flow에 통합했습니다. AI 추정·기능 감가·원문 견적 목록·외관 불일치 제안을 보존하고 원문 참고가/AI 추정/AI 감가/희망가를 구분했습니다. 파손 기준의 중복 감가와 시세 갱신 후 이전 AI 캐시 사용도 막았습니다. 호준님 part1은 최신 코드 그대로 두고 이전/새 JSON과 가변 터치를 연결했습니다. npm 테스트 27개와 자체 점검 4개, Chrome 등록→구매 요청→판매자 확인→명시적 완료, 실제 수집 재실행·서버 가격 갱신이 통과했습니다. 실제 Gemini·파손 사진 정확도·Cloud 운영은 인증정보/자료 부족으로 미검증입니다. 시작 화면 PR #1은 미병합 상태여서 연결점만 기록했습니다. GitHub 쓰기 권한이 확인되어 작업 브랜치 업로드를 진행하며, 최종 커밋과 push 결과는 별도 완료 보고에 기록했습니다. main으로 병합·배포하지 않았습니다. 이 초안은 전송하지 않았습니다.
