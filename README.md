# Green Circuit

중고 스마트폰 **① 웹 하드웨어 테스트 → ② Gemini 시세·처분 판단 → ③ 성능 보증서 → ④ 구매자 추천** 을 서버 하나로 잇는 GDGoC 해커톤 1팀 프로젝트.

## 실행

```bash
npm install
cp .env.example .env        # 복사해서 새로 만든 .env 파일에 GEMINI_API_KEY=본인키 입력 (윈도우 PowerShell: copy .env.example .env)
npm run share               # 서버 + 폰용 HTTPS 터널(cloudflared) + QR
npm run seed                # (선택) 데모 보증서 9장
npm test                    # ②·④ 자체 점검
```

| 화면 | 주소 | 토큰 |
|---|---|---|
| ① 하드웨어 테스트 | `/?t=토큰` | 필요 |
| ②③ 판매자 (AI 판별·시세·보증서 발급) | `/seller?t=토큰` | 필요 |
| ③ 보증서 | `/c/{id}` | 없음 |
| ④ 구매자 추천 | `/buyer` | 없음 |

> **API 키는 `.env` 에만 넣으세요.** 서버는 `.env` 만 읽습니다. `.env.example` 은 깃헙에 올라가는 예시 파일이라 키를 넣으면 공개됩니다. `.env` 는 `.gitignore` 에 있어 올라가지 않습니다. 키가 없으면 AI 없이 규칙 기반으로 동작합니다.
> 윈도우 탐색기·메모장으로 만들면 이름이 `.env.txt` 가 되기도 합니다 (확장자가 숨겨져 `.env` 로 보임). 서버는 `.env.txt` 도 읽고 git 도 무시하니 그대로 써도 됩니다.

모든 화면 위에 판매자 / 구매자 탭이 있습니다. 토큰은 서버 시작 때 터미널에 나옵니다 (`.env` 의 `ACCESS_TOKEN` 으로 고정 가능).
배포는 [`common/docs/DEPLOY.md`](common/docs/DEPLOY.md) (Cloud Run + Firestore).

## 폴더와 담당

| 폴더 | 파트 | 담당 | 핵심 파일 |
|---|---|---|---|
| [`part1_hardware_test/`](part1_hardware_test/) | ① 웹 성능 테스트 | 김호준 | `index.html`, `lib/camera-profile.js` |
| [`part2_price_disposal/`](part2_price_disposal/) | ② Gemini 시세·처분 판단 | 신현서 · 서석훈 | `lib/price.js`, `lib/assessment.js`, `data/` |
| [`part3_certificate/`](part3_certificate/) | ③ 성능 보증서 | 송영찬 | `seller.html`, `certificate.html`, `lib/seller-routes.js`, `lib/certificate.js` |
| [`part4_buyer/`](part4_buyer/) | ④ 구매자 비교 | 송영찬 | `buyer.html`, `lib/buyer.js` |
| [`common/`](common/) | 공통 UI·저장소·스크립트 | 안시예(UI) · 전원 | `assets/ui.css`, `assets/nav.js`, `lib/certificate-store.js` |
| 루트 `server.js` | 공통 서버 | 전원 | 라우팅, Gemini 호출, ① 카메라 분석·결과 저장 |

각 폴더 README 맨 위에 그 파트의 파일과 **다른 파트와 겹치는 곳**이 적혀 있습니다.

## 파트 사이 연결 (바꾸면 다른 파트가 깨지는 곳)

```
① index.html ──POST /api/report──▶ 결과 JSON (device-hw-test/v1)
     형식: common/result.schema.json · common/scripts/validate.js
                                   │
② /api/assess (사진·배터리 → Gemini) ─┤  part3 seller-routes.js 안에 라우트, 로직은 part2
② price.lookup · assessment.recommend ┤
                                   ▼
③ POST /api/certificates ──▶ 보증서 seller-certificate/v1 (assessment 칸에 ② 결과)
     저장: common/lib/certificate-store.js (로컬 store/ · results/ 또는 Firestore)
                                   │ listItem()
                                   ▼
④ /api/public/recommend ──▶ 추천 목록
```

- **겹치는 파일**: `part3_certificate/seller.html` 4단계와 `seller-routes.js` 의 `/api/assess` 는 ② 기능(주석으로 표시). `server.js` 의 `/api/analyze-camera` 는 ① 기능.
- **형식 규칙**: 결과 JSON·보증서 JSON 은 필드 추가만. 바꾸거나 지우려면 `schema` 버전을 올리고 팀에 공유.
- `.env`, `store/`, `results/` 는 git 에 올리지 않습니다 (키·개인 테스트 사진).

## 다음 할 일 (2026-11-03 기준)

- ① 마이크·스피커 정밀 측정(녹음 품질 등급), 카메라 촬영 가이드, 전체 화면 터치 테스트
- ② 시세 갱신 정책 (Gemini 검색·일별 수집), 실제 화면 파손 사진으로 시세·추천 검증, 처분 추천 기준금액(`DONATE_BELOW_KRW`, 임시 3만원) 확정
- ③ Firebase Authentication(구글 로그인) → 판매자 계정별 보증서·환경 온도 (지금은 공용 토큰 + 닉네임)
- 배포: Cloud Run + Firestore (`common/docs/DEPLOY.md`)
