> **이 폴더: ② 시세·처분 판단** · 담당 신현서 · 서석훈
> 파일: `lib/price.js`(시세 CSV 조회) · `lib/fault-adjust.js` + `prompts/fault-deduction.*`(알려진 기능 고장 내용이 있으면 '기능 정상' 기준 시세에서 그 고장만큼 Gemini 가 판단해 차감) · `lib/price-estimate.js` + `prompts/price-estimate.*`(CSV 에 없는 조합을 같은 CSV 의 같은 기종·같은 제조사 행 근거로 Gemini 추정, 'AI 추정 참고가' 로 표시) · `lib/assessment.js`(Gemini 외관·배터리 판별 정리, 처분 추천 규칙, 매뉴얼 섹션) · `prompts/assessment.*` · `data/`(시세 CSV, 처리 매뉴얼, `raw/` 업체별 원자료)
> ③ 과 겹치는 곳: API 라우트(`/api/assess`, `/api/price/quote` 의 `disposal`)와 발급 시 `assessment` 저장은 `part3_certificate/lib/seller-routes.js` 에, 판별 UI 는 `part3_certificate/seller.html` 4단계에 있습니다.
> 자체 점검: 루트에서 `npm test`

# ② Gemini 시세·처분 판단

담당: 신현서 · 서석훈 (시세 기준표 데이터: 고영휘 · 서석훈)

```
/seller 4단계: 앞·뒷면 사진 + 배터리 캡처 → [AI로 상태·배터리 판별]
   POST /api/assess ── Gemini 1회 (prompts/assessment.*) ──▶ 외관 상태 "제안" + 배터리 % 판독
        │  결과는 서버 메모리에 assessId 로 보관 (클라이언트가 보낸 판별값은 믿지 않음)
        ▼
   판매자가 상태 확정 → POST /api/price/quote
        시세(lib/price.js) + 처분 추천(lib/assessment.js recommend, 규칙) + 처리 매뉴얼 섹션 본문
        ▼
   POST /api/certificates { ..., assessId } → 보증서 assessment 칸에 저장 (무결성 해시 포함)
```

## 보증서 `assessment`

| 필드 | 내용 |
|---|---|
| `ai` | Gemini 판별 원본 정리값. AI 판별을 안 했으면 `null` |
| `ai.condition` | `code`(7개 상태 중 하나, 판단 불가면 `null`), `confidence`, `damages[]`, `evidence_ko`, `caveats_ko[]` |
| `battery` | `healthPct`, `statusLabel`, `cycleCount`, `osHint`, `low`(80% 미만), `source: "seller_screenshot"`. 캡처가 배터리 화면이 아니면 `null` |
| `sellerAgreesWithAi` | AI 제안과 판매자 확정 상태가 같은가 (다르면 신뢰도 사유에 표시) |
| `disposal` | `action`(`sell` / `sell_parts` / `donate`), `label_ko`, `reasons_ko[]`, `alternatives[]`, `manualSections[]` |

④ 구매자용 공개 목록(`/api/public/certificates`)에도 `battery.healthPct`, `disposal` 이 추가됩니다.

## 규칙 (매뉴얼 기준)

- 가격은 Gemini가 만들지 않음. 항상 `price.lookup()` 결과.
- AI 외관 판별은 제안. 확정은 판매자가 하고 보증서에는 둘 다 남김.
- 처분 추천은 규칙(`recommend`)으로 결정하고 사용자에게 강제하지 않음.
  - 파손 상태(`rear_damage`, `display_fault`, `damage_or_fault`) + 시세 있음 → 파손폰 업체 매입, 시세 없음 → 기부·배출
  - 매입 최고가 `DONATE_BELOW_KRW`(임시 3만원) 미만 → 기부·배출
  - 그 외 → 판매
- 배터리 %는 판매자가 올린 캡처를 읽은 값이라 "판매자 캡처 기준"으로만 표시.

## 확인

```bash
node lib/assessment.js   # 처분 규칙·정규화·매뉴얼 섹션 자체 점검
```
Gemini 키가 없으면 `/api/assess` 는 503 으로 "직접 골라 주세요"를 돌려주고, 나머지(시세·추천·발급)는 그대로 동작합니다.
