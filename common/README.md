# 공통

여러 파트가 같이 쓰는 파일입니다. 고치기 전에 팀에 알려 주세요.

| 파일 | 내용 | 쓰는 곳 |
|---|---|---|
| `assets/ui.css` | 공통 디자인 (색·버튼·카드) | 모든 화면 |
| `assets/nav.js` | 화면 위 판매자 / 구매자 탭, 토큰 기억 | 모든 화면 |
| `lib/certificate-store.js` | 저장소: 보증서·사진·사용자·테스트 결과. `STORE=local`(기본, `store/`·`results/` 폴더) / `STORE=firestore` | 서버, ③, ④, seed |
| `result.schema.json`, `scripts/validate.js` | ① 결과 JSON 형식 (`device-hw-test/v1`) 과 검증 | 서버, ③ |
| `scripts/share.js` | 서버 + cloudflared 터널 + QR (`npm run share`) | — |
| `scripts/models.js` | 쓸 수 있는 Gemini 모델 목록 (`npm run models`) | — |
| `docs/DEPLOY.md` | Cloud Run 배포 | — |

루트 `server.js` 도 공통입니다: `.env` 읽기, 토큰 확인, Gemini 호출(`geminiJson`, 이미지 포함 가능), ① 카메라 분석·결과 저장, ③④ 라우트 연결.

2026-11-03: `assets/market.js`는 상세 화면의 구매 요청·판매자 관리 UI입니다. `certificate-store.js`에 비공개 관리키 해시/요청 저장과 완료 트랜잭션을 추가했습니다. 로컬은 단일 Node 프로세스+복구 journal, Firestore는 트랜잭션을 사용합니다. 공개 JSON·v1 무결성 해시 구조는 유지합니다. [통합 주의사항](docs/PRICE_PLATFORM_HANDOFF.md).
