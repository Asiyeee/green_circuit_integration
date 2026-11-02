# ④ 구매자 파트 시작 가이드

이 폴더를 받은 구매자 파트 담당자를 위한 문서입니다. 위에서부터 따라 하면 10분 안에 데모 데이터로 개발을 시작할 수 있습니다.
(넘긴 사람: ③ 판매자 파트 송영찬)

## 0. 지금까지 된 것

| 파트 | 상태 | 어디 |
|---|---|---|
| ① 웹 성능 테스트 (김호준) | 완료 | `index.html`, `/` |
| ② Gemini 시세·처분 판단 (신현서·서석훈) | 이 폴더에는 없음. 결과를 넣을 자리(`assessment`)만 있음 | — |
| ③ 판매자 성능 보증서 (송영찬) | 완료. 시세·탄소 영수증·환경 온도·Gemini 요약 | `/seller`, `/c/{id}`, [SELLER_CERTIFICATE.md](SELLER_CERTIFICATE.md) |
| **④ 구매자 비교** | **여기서부터** | 이 문서 |

기획서 기준 ④ 가 할 일: **원하는 조건 입력 → 보증서와 비교 → 조건에 맞는 기기 + 적합도 표시**, 그리고 판매자 **환경 온도**를 신뢰 지표로 보여 주기.

## 1. 10분 시작

준비물: Node.js 20 이상 (`node --version`). macOS 는 `brew install node`.

```bash
npm install
cp .env.example .env
```
`.env` 에 두 줄을 넣으면 편합니다. (줄 끝에 `#` 주석을 붙이면 값에 섞이니 주석은 따로 줄에 쓰세요)
```
# 토큰 고정 (안 넣으면 켤 때마다 바뀜)
ACCESS_TOKEN=dev
# 있으면 넣기. 없어도 전부 동작합니다
GEMINI_API_KEY=
```
데모 보증서 9장 만들기 → 서버 켜기:
```bash
npm run seed
npm start
```
| 열어 볼 주소 | 내용 |
|---|---|
| http://localhost:3000/api/public/certificates | 보증서 목록 JSON (④ 가 주로 쓸 것) |
| http://localhost:3000/c/{id} | 보증서 화면 (목록의 `url`) |
| http://localhost:3000/seller?t=dev | 판매자 발급 화면 |
| http://localhost:3000/?t=dev | ① 테스트 화면 |

- 데모 데이터를 다시 만들려면 `npm run seed -- --reset`. 데모 보증서에는 `demo: true` 가 붙어 있습니다.
- 실제 폰으로 테스트하려면 `npm run share` (cloudflared 필요, README 1장).

데모 9장은 일부러 경우를 섞었습니다: 깨끗한 기기, 마이크 실패, 화면 불량+기능 이상, 시세 없는 기종(Galaxy A55, Pixel 8), 공식 탄소 값이 없는 기종(Pixel 8, 추정치), 이미 판매·기부된 기기.

## 2. 쓸 API (토큰 없음, CORS 열림)

| 요청 | 응답 |
|---|---|
| `GET /api/public/certificates?limit=50` | `{ schema, count, items: [목록 항목] }` 최신순 |
| `GET /api/public/certificates/{id}` | `{ certificate, verified, expired, seller }` |
| `GET /api/public/users/{nickname}` | 환경 온도, 행동 기록(`actions`), 온도 규칙(`rules`) |
| `GET /c/{id}/photos/{n}.jpg` | 보증서 사진 |

**목록 항목** (`npm run seed` 데이터의 응답 예시, id 는 실행마다 다름):
```json
{
  "id": "x8Hn2kQp1A", "url": "/c/x8Hn2kQp1A",
  "issuedAt": "2026-11-02T05:10:00.000Z", "expiresAt": "2026-12-02T05:10:00.000Z",
  "status": "listed",
  "seller": "민지",
  "device": { "brand": "Apple", "model": "iPhone 13", "modelKey": "iphone13", "storage": "128GB", "matchesUserAgent": true, "platform": "iPhone", "screen": { "width": 390, "height": 844, "dpr": 3 } },
  "condition": { "code": "clean", "label_ko": "흠집·파손·잔상 없음", "knownFault": "none", "knownFaultLabel_ko": "없음", "source": "seller_declared" },
  "test": { "passedCount": 5, "totalCount": 5, "allPassed": true, "statuses": { "camera": "pass", "microphone": "pass", "speaker": "pass", "touch": "pass", "gyro": "pass" }, "cameraPhotoGrade": "B" },
  "price": { "status": "ok", "minKrw": 240000, "maxKrw": 350000, "label_ko": "업체 매입 참고 범위" },
  "carbon": { "avoidedKg": 51.8, "basis": "official" },
  "trust": "high",
  "thumbnail": null
}
```
상세(`certificate`) 전체 구조는 [`sample-certificate.json`](../sample-certificate.json) 과 [SELLER_CERTIFICATE.md 2장](SELLER_CERTIFICATE.md#2-보증서-json-seller-certificatev1) 에 있습니다. 판매자 온도는 상세 응답의 `seller.temperature` 또는 users API 로 가져옵니다.

## 3. 코드를 어디에 둘까

**A. 같은 서버에 붙이기 (추천, 설정 없음)** — 판매자 파트와 같은 방식입니다.
1. `buyer.html` 을 만들고 `fetch('/api/public/certificates')` 로 목록을 읽습니다.
2. 서버 기능이 필요하면 `lib/buyer-routes.js` 를 만들고 `server.js` 의 `start()` 에서 판매자 라우트처럼 등록합니다:
   ```js
   // server.js start() 안, state.sellerRoutes 아래
   state.buyerRoutes = createBuyerRoutes({ cfg, store, sendJson, readJson, httpError, geminiJson: (o) => geminiJson(cfg, state, o) });
   // handle() 안, sellerRoutes 호출 바로 아래
   if (state.buyerRoutes && await state.buyerRoutes(req, res, url, tokenOk(given, cfg.token))) return;
   ```
   `lib/seller-routes.js` 를 복사해서 시작하면 됩니다. 저장소(`store`)는 같은 것을 씁니다.

**B. 따로 만든 프런트엔드 (React/Vite 등)** — `http://localhost:3000/api/public/...` 를 그대로 fetch 하면 됩니다 (CORS 허용).

## 4. 적합도 계산 예시 (출발점)

조건 예: 예산 30만원, Apple, 128GB 이상, 외관 생활 흠집까지, 카메라 중요.
```js
const ORDER = ['clean', 'minor_wear', 'visible_wear', 'burn_in', 'rear_damage', 'display_fault', 'damage_or_fault'];
const GB = (s) => (/TB$/.test(s) ? parseFloat(s) * 1024 : parseFloat(s));

function fit(c, want) {
  if (c.status !== 'listed') return null;                                  // 판매 중만
  if (want.brand && c.device.brand !== want.brand) return null;
  if (want.minStorage && GB(c.device.storage) < GB(want.minStorage)) return null;
  if (ORDER.indexOf(c.condition.code) > ORDER.indexOf(want.worstCondition)) return null;
  let score = 0;
  score += c.test.passedCount / c.test.totalCount * 40;                     // 테스트 통과율
  score += { high: 20, medium: 10, low: 0 }[c.trust];                        // 신뢰도
  if (c.price.status === 'ok') score += Math.max(0, 1 - c.price.minKrw / want.budget) * 20; // 예산 여유
  if (want.camera && c.test.cameraPhotoGrade) score += { S: 20, A: 16, B: 12, C: 6, D: 0 }[c.test.cameraPhotoGrade];
  return Math.round(score);
}
```
Gemini 로 "왜 이 기기가 맞는지" 설명을 붙이려면 `prompts/` 에 프롬프트·스키마를 두고 서버의 `geminiJson()` (server.js) 을 쓰면 됩니다. 팀 규칙대로 **Gemini 를 쓰는 위치를 문서에 적어 주세요** (판매자 파트는 SELLER_CERTIFICATE.md 6장).

## 5. 거래 확정과 환경 온도

구매가 끝나면 아래 API 로 보증서를 닫습니다. 판매자 환경 온도가 오르고 보증서 상태가 `sold` 가 됩니다. 토큰이 필요합니다(`x-access-token` 헤더 또는 `?t=`).
```bash
curl -X POST "http://localhost:3000/api/certificates/{id}/outcome?t=dev" -H 'Content-Type: application/json' -d '{"type":"sold"}'
```
`type`: `sold` 판매 / `donated` 기부 / `recycled` 배출. 한 보증서에 한 번만 됩니다(두 번째는 409).
온도 규칙: 시작 36.5°C, 발급 +0.1, 판매 시 회피 탄소 10kg 당 +0.1, 기부는 +0.2 추가, 배출 +0.3 (`lib/eco-temperature.js`).

## 6. 화면에 쓸 때 지켜 주세요

- 새 화면은 `<link rel="stylesheet" href="/assets/ui.css">` 를 넣고 `.appbar`, `.page`, `.section`, `.btn`, `.status` 같은 공통 클래스를 쓰면 기존 화면과 톤이 맞습니다. 색은 `:root` 토큰만 바꾸면 전체가 바뀝니다.
- 문체: 사용자에게 말하는 화면(점검·발급)은 "~해 주세요/~돼요", 보증서처럼 문서인 화면은 존댓말 없이 명사형("배터리 상태 미점검")으로 씁니다.

- 시세는 **업체 매입 참고 범위**입니다. 실제 거래가·보장가처럼 쓰지 마세요. `price.status` 가 `ok` 가 아니면 가격이 없습니다(0원 아님).
- `cameraPhotoGrade` 는 **사진 화질 등급**입니다. 외관 등급이 아닙니다.
- `condition` 은 **판매자가 고른 값**입니다. 배터리는 측정하지 않았습니다.
- `status` 가 `expired`(30일 지남), `sold`, `donated`, `recycled` 인 보증서는 판매 중이 아닙니다.
- 상세의 `verified` 가 `false` 면 내용이 바뀐 보증서입니다. 경고를 보여 주세요.
- 탄소 `basis: "estimate"` 는 공식 값이 없는 기종의 추정치입니다.

## 7. 파일 지도

```
server.js               서버 (외부 의존성 없음). 라우트 등록, Gemini 호출 도우미(geminiJson)
assets/ui.css           공통 디자인 시스템 (색·글꼴·버튼·입력·상태 표시). 새 화면도 이걸 쓰면 톤이 맞음
index.html              ① 테스트 화면
seller.html             ③ 보증서 발급 화면
certificate.html        ③ 보증서 공개 화면 (구매자에게도 이 화면을 보여 주면 됨)
lib/seller-routes.js    ③ API + 발급 로직(createSellerService)
lib/certificate.js      보증서 JSON 생성·무결성·요약
lib/certificate-store.js 저장소 (store/ 폴더 또는 Firestore)
lib/price.js            시세 조회 (data/중고폰_시세_통합.csv)
lib/carbon.js           탄소 회피량 (data/device-carbon.json)
lib/eco-temperature.js  환경 온도 규칙
scripts/seed-demo.js    데모 보증서 만들기 (npm run seed)
data/                   시세 CSV, 업체 조사 원자료, 처리 매뉴얼, 기종별 탄소 데이터
prompts/                Gemini 프롬프트 (카메라 분석, 보증서 요약)
docs/                   이 문서, 판매자 파트 문서
```

## 8. 알려진 한계

- 저장소는 기본이 로컬 `store/` 폴더라 **서버를 켠 노트북에만** 데이터가 있습니다. 여러 명이 같이 쓰려면 Firestore 로 바꾸세요 (SELLER_CERTIFICATE.md 7장, 아직 실제 프로젝트로는 확인 안 함).
- Gemini 요약은 키가 없어 실제로는 확인하지 못했습니다. 키가 없거나 실패하면 규칙 기반 요약이 들어갑니다(`summary.by: "rule"`).
- ② 결과(외관 사진 판정·처분 추천)는 아직 없습니다. 생기면 보증서 `assessment` 에 들어갑니다.
- 보증서 목록 API 에는 검색·필터가 없습니다. 지금은 전부 받아서 프런트에서 거르면 됩니다(데모 규모에서는 충분).
