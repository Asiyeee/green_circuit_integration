> **이 폴더: ③ 성능 보증서** · 담당 송영찬
> 파일: `seller.html`(판매자 화면 `/seller`) · `certificate.html`(보증서 `/c/{id}`) · `lib/seller-routes.js`(판매자·공개 API) · `lib/certificate.js` · `lib/carbon.js` · `lib/eco-temperature.js` · `prompts/certificate-summary.*` · `data/device-carbon.json` · `scripts/seed-demo.js`
> ② 와 겹치는 곳: `seller.html` 4단계(외관 사진·배터리 AI 판별)와 3단계 처분 추천 표시, `seller-routes.js` 의 `/api/assess` 는 ② 기능입니다. 고칠 때 ② 담당과 맞춰 주세요.
> ④ 가 쓰는 것: `seller-routes.js` 의 `listItem()` (공개 목록 형식). 필드를 지우거나 바꾸면 ④ 가 깨집니다.
> 아래 문서의 `data/`, `lib/` 경로 중 `price.js` 와 시세 CSV 는 이제 `part2_price_disposal/` 에 있습니다.

# ③ 판매자: 성능 보증서 + 탄소 영수증 + 환경 온도

**2026-11-03 통합 변경:** 보증서 `listed` 자체가 플랫폼 매물입니다. 판매 화면은 희망가 입력 후 등록하고 상세에서 문의를 받습니다. 파손·시세 없음도 등록할 수 있습니다. 새 문의 확인·완료 처리는 **서버 토큰 + 해당 매물의 비밀 관리키**가 필요합니다. 관리키는 발급 응답의 `ownerToken`으로 한 번 전달되어 브라우저에 보관되며 공개 보증서에는 들어가지 않습니다. 기존 관리키 없는 보증서는 열람을 유지하고 변경은 차단합니다. 아래 초기 구현 설명보다 [현재 인계 문서](../common/docs/PRICE_PLATFORM_HANDOFF.md)를 우선합니다.

담당: 송영찬 · 다음 담당: ④ 구매자 비교

```
① 테스트 결과 JSON (results/*.json, device-hw-test/v1)
        │  + 판매자 입력: 저장 용량 · 외관 상태 · 알려진 기능 이상 · 외관 사진 · 닉네임
        ▼
  /seller 페이지 ──POST /api/certificates──▶ 서버
        │   ├─ 시세: data/중고폰_시세_통합.csv  (lib/price.js, 매뉴얼 규칙 그대로)
        │   ├─ 탄소: data/device-carbon.json    (lib/carbon.js, 제조사 공식 값)
        │   ├─ Gemini: 보증서 종합 요약문         (prompts/certificate-summary.*)
        │   └─ 저장: store/ 또는 Firestore        (lib/certificate-store.js)
        ▼
  보증서 seller-certificate/v1  ──▶  /c/{id} 공개 페이지 (링크·QR)
                                ──▶  GET /api/public/certificates  ← ④ 구매자가 여기서 읽음
```

## 1. 써 보기

```bash
npm run share
```
터미널에 `보증서 발급: http://localhost:3000/seller?t=...` 줄이 나옵니다. 폰에서는 QR 주소의 `/` 를 `/seller` 로 바꿔 열면 됩니다. 폰에서 5개 테스트를 끝내면 저장 메시지 아래에 보증서 만들기 링크도 나옵니다.

1. 테스트 결과 고르기 (results/ 목록 또는 JSON 파일 업로드)
2. 저장 용량 · 외관 상태 · 기능 이상 선택 → 시세와 탄소 회피량이 바로 미리 보입니다
3. 앞·뒷면 사진, 닉네임 → **보증서 발급**
4. 링크·QR과 별도 관리키가 나옵니다. `/c/{id}?t=토큰`에서 이 브라우저에 저장된 해당 관리키로 요청 확인·완료 처리를 합니다. 요청만으로 완료되지 않으며 실제 판매·기부·배출 후 확인란을 체크하고 완료를 기록합니다.

폰 없이 확인하려면 `/seller` 에서 `sample-result.json` 을 업로드하거나, `npm run seed` 로 데모 보증서 9장을 한 번에 만드세요(`demo: true` 표시, `npm run seed -- --reset` 으로 다시 만들기). 결과 예시는 [`sample-certificate.json`](../sample-certificate.json) 입니다.

## 2. 보증서 JSON (`seller-certificate/v1`)

| 필드 | 내용 |
|---|---|
| `id`, `issuedAt`, `expiresAt` | 10자리 ID, 발급 시각, 유효기간(발급 후 30일) |
| `seller` | `nickname`, `temperatureAtIssue` (발급 직후 환경 온도) |
| `device` | `brand`, `model`, `modelKey`, `storage`, `matchesUserAgent`(고른 기종이 브라우저와 맞는가) |
| `condition` | `code`(아래 7개), `label_ko`, `knownFault`(`none`/`yes`/`unknown`), `source: "seller_declared"` |
| `test` | `passedCount`/`totalCount`, `allPassed`, `items.{camera,microphone,speaker,touch,gyro}.status` 와 핵심 수치, `batteryTested: false` |
| `price` | `status`: `ok` / `no_data` / `needs_check` / `needs_input`. `ok` 이면 `minKrw`, `maxKrw`, `label_ko`, `vendorCount`, `quotes[]`(업체별 원문) |
| `carbon` | `avoidedKg`, `basis`(`official`/`estimate`), `lifecycleKg`, `productionShare`, `source`, `equivalence.oakTreesYear` |
| `ecoPreview` | 판매·기부·배출로 끝났을 때 오를 온도 미리보기 |
| `summary` | `by`(`gemini`/`rule`), `summary_ko`, `strengths_ko[]`, `cautions_ko[]`, `eco_line_ko` |
| `trust` | `level`(`high`/`medium`/`low`), `reasons[]` |
| `photos[]` | `kind`(`test_camera`/`front`/`back`…), `url`, `sha256` |
| `status`, `outcome` | `listed` → `sold` / `donated` / `recycled`. 처리 결과와 오른 온도 |
| `assessment` | ② 상태 제안·판매자 확인·선택적 배터리 캡처 판독·플랫폼 판매 안내. AI 미사용 시 `ai: null` |
| `integrity.sha256` | 발급 시점 내용의 해시. 페이지에 "원본과 일치"로 표시 |

`condition.code`: `clean` 깨끗함 · `minor_wear` 생활 흠집 · `visible_wear` 뚜렷한 흠집 · `burn_in` 잔상 · `rear_damage` 후면 파손 · `display_fault` 화면 불량 · `damage_or_fault` 파손·기능 이상

**규칙**: 필드는 추가만 합니다. 바꾸거나 지우려면 `schema` 를 `v2` 로 올리세요. `price`, `carbon.lifecycleKg`, `summary`, `assessment` 는 비어 있을 수 있습니다.

## 3. ④ 구매자 파트가 쓸 API (토큰 없이 열림)

| 요청 | 응답 |
|---|---|
| `GET /api/public/certificates?limit=50` | `{ items: [...] }` 비교용 요약 목록 (가격·상태·통과 수·탄소·신뢰도·썸네일) |
| `GET /api/public/certificates/{id}` | `{ certificate, verified, expired, seller: { temperature, totalAvoidedKg, ... } }` |
| `GET /api/public/users/{nickname}` | 환경 온도, 행동 기록, 온도 규칙 |
| `GET /c/{id}` | 보증서 페이지 (구매자에게 보여 줄 화면) |

판매 완료는 판매자 전용입니다: `POST /api/certificates/{id}/outcome` `{ "type": "sold" | "donated" | "recycled" }`. `x-access-token`과 `x-owner-token` 헤더가 모두 필요합니다. 구매자는 이 API로 완료하지 않고 구매 요청을 저장합니다. 목록 API는 판매 중/유효 보증서만 반환하며 종료 기록은 상세 API로 계속 읽습니다.

조건 비교 예 (JS):
```js
const { items } = await (await fetch('/api/public/certificates')).json();
const hits = items.filter((c) => c.status === 'listed'
  && c.device.brand === 'Apple'
  && c.test.allPassed
  && c.price.status === 'ok' && c.price.maxKrw <= 300000
  && ['clean', 'minor_wear'].includes(c.condition.code));
```

## 4. 시세 규칙 (data/스마트폰_처리_매뉴얼.md 그대로)

- 조회 키는 `brand + model_key + storage + condition_code` 정확히 일치. 없으면 "해당 조건의 시세 정보 없음". 다른 용량·상태로 대체하거나 0원을 쓰지 않습니다.
- 깨끗함·생활 흠집 같은 '정상 기능 전제' 상태는 기능 이상 "없음"일 때만 가격을 냅니다. "모름"이면 `needs_check`.
- 업체 1곳이면 '단일 업체 참고가', 여러 곳이면 '업체 매입 참고 범위'. 실제 거래가·보장가로 표시하지 않습니다.
- 카메라 사진 등급(`photoGrade`)은 외관·시세 등급으로 바꾸지 않습니다.

## 5. 탄소 영수증과 환경 온도

**탄소 회피량** = 중고 기기 1대가 재사용되면 새 기기 1대의 **생산 단계** 배출을 대신한다고 보고 그 값을 씁니다 (최대 추정치).

| 제조사 | 값 | 출처 |
|---|---|---|
| Apple (iPhone 8 ~ 17, 37개 기종) | 용량별 전 과정 배출량 × 생산 비율 | 각 기종 Product Environmental Report |
| Samsung (S23 ~ S26, Z Flip/Fold 5~8, A16~A56 등 31개) | Manufacturing 단계 kg | Samsung "LCA Results for Smartphones", S23 계열은 제품 환경 보고서 |
| 그 외 | 같은 제조사 공식 값 중앙값 (`basis: "estimate"`) | — |

값과 출처 파일명은 모두 [`data/device-carbon.json`](../data/device-carbon.json) 에 있습니다. 나무 환산은 국립산림과학원 30년생 상수리나무 연 14.4kg 기준입니다.

**환경 온도** (`lib/eco-temperature.js` 의 `RULES` 만 고치면 바뀝니다)

| 행동 | 오르는 온도 |
|---|---|
| 시작 | 36.5°C |
| 보증서 발급 | +0.1 |
| 판매로 재사용 | 회피 10kg 당 +0.1 (예: iPhone 12 128GB 62.3kg → +0.62) |
| 나눔폰 기부 | 판매와 같음 + 0.2 |
| 올바른 배출 | +0.3 (탄소 kg 은 산정 안 함) |

## 6. Gemini 사용 위치

| 위치 | 하는 일 | 파일 |
|---|---|---|
| 보증서 발급 시 1회 | 테스트·시세·상태·탄소를 묶어 구매자용 요약(장점·확인할 점·탄소 한 줄) 작성 | `prompts/certificate-summary.system.md`, `.schema.json` |

키가 없거나 실패하면 규칙 기반 요약으로 대신하고 `summary.by: "rule"` 로 남깁니다. 요약은 해시에서 빠지므로 나중에 다시 만들어도 무결성이 깨지지 않습니다.

## 7. Firebase 로 바꾸기

지금은 `store/` 폴더에 저장합니다 (git 제외). Firestore 로 바꾸려면:
1. Firebase 콘솔에서 프로젝트 생성 → Firestore 데이터베이스 만들기
2. 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성 → 레포 폴더에 `firebase-service-account.json` 으로 저장 (git 제외됨)
3. `npm install firebase-admin`
4. `.env` 에 `STORE=firestore`, `FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json`
5. 서버 재시작. 컬렉션: `certificates`, `certificatePhotos`(사진 base64, 900KB 넘으면 건너뜀), `users`

## 8. 확인한 것 / 안 한 것

- 확인함: 샘플 결과로 발급(시세 ok·needs_check·no_data), 실제 iPhone 테스트 결과로 발급, 사진 업로드·조회, 판매·기부·배출 처리와 온도 반영, 중복 처리 차단, 토큰 없는 발급 차단(401), 무결성 일치, 새 폴더에서 `npm install → npm run seed → npm start`, 공개 API CORS
- 확인 못 함: **Firestore 저장**(프로젝트가 아직 없음), **Gemini 요약**(키가 없어 규칙 요약만 확인), 실제 폰으로 찍은 결과로 발급

## 9. 다음에 하면 좋은 것

- ② 결과(외관 사진 → 상태 판정, 처분 추천)가 나오면 `assessment` 에 넣고, 판매자가 고른 상태와 다르면 `trust.reasons` 에 추가
- 직거래 현장 재검사: 같은 기기에서 간이 테스트를 다시 돌려 `device.screen`·카메라 정보가 같은지 비교
- 디자인(안시예님) 적용: 세 화면 모두 `assets/ui.css` 의 `:root` 토큰(색·글꼴·모서리)을 공유합니다. 토큰만 바꿔도 전체 톤이 바뀝니다
- 보증서 문구는 문서체(명사형, 존댓말 없음)로 통일했습니다. Gemini 요약도 같은 문체로 쓰도록 프롬프트에 적어 두었습니다
