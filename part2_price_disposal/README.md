# ② 업체 매입 참고가 · 상태 제안 · 처리 안내

담당 영역: `lib/price.js`, `lib/assessment.js`, `prompts/assessment.*`, `data/`, `scripts/price-refresh.js`. 공개 수집/증분 병합은 `lib/price-sources.js`/`price-collection.js`, 일별 실행은 `scripts/price-daily.js`, 별도 Gemini 검색은 `lib/price-search.js`, Cloud Run 연결은 `lib/price-cloud.js`입니다.
통합 API/화면은 ③의 `lib/seller-routes.js`, `seller.html`과 연결됩니다.

1. 점검 JSON에서 제조사·기종을 읽고 판매자가 저장 용량·외관 상태·알려진 기능 이상(없음/있음/모름)을 추가합니다. RAM과 카메라 사진 화질은 시세 조회 조건이 아닙니다.
2. 선택 사항인 외관 사진·배터리 캡처를 `/api/assess`에 보내면 Gemini가 외관을 **제안**합니다. 자동 선택하지 않으며 판매자가 확인·적용합니다. 내부 기능 정상 여부는 사진으로 판단하지 않습니다. 키 부재·실패·판단 불가에도 수동 선택과 등록이 가능합니다.
3. 업체 원문 참고가는 `brand + model_key + storage + condition_code`로 정확히 조회합니다. 알려진 고장이 있으면 최신 main의 명시적 `damage_or_fault` 재분류를 표시합니다. 없으면 `no_data`, 용량 미확인은 `needs_input`, 기능 조건 미확인은 `needs_check`입니다. 모름을 다섯 테스트 통과로 정상으로 바꾸지 않습니다.
4. 별도 `price-estimate.js`는 `no_data` 조합만 같은 CSV 근거로 AI 추정합니다. 자료 없음·근거 행·출처·불확실성을 보존하고 업체 원문/검증 CSV에 섞지 않습니다. `fault-adjust.js`는 손상이 포함되지 않은 clean/minor_wear/visible_wear 기준가에 판매자의 기능 고장 설명을 해석해 AI 감가합니다. 파손/잔상/화면 고장 기준의 추가 차감은 중복 우려로 생략합니다. 감가액은 검증된 수리비나 직접 진단이 아닙니다. 키/근거 부족·실패에도 수동 입력·등록이 가능합니다. 캐시는 CSV 해시·모델·프롬프트 변경 때 무효화됩니다.
5. 판매자가 정한 희망가로 우리 플랫폼에 보증서 연결 매물을 등록합니다. 파손·시세 없음·낮은 참고가만으로 판매를 배제하지 않습니다. 기부·재활용·배출 안내는 대안이며 실제 완료 기록은 별도입니다.

가격은 업체 매입 **참고가**입니다. 업체 1곳 여부는 금액이 아닌 `vendorCount`로 표시합니다. 서로 다른 업체의 원래 등급·조건·링크를 유지하며 공통 공식 등급처럼 설명하지 않습니다. `checkedOn`은 자료 확인일, `quotes[].priceDate`/`priceDateSource`는 원문 가격 기준일입니다. 배터리·잔상·수리 이력·검수 조건에 따라 실제 매입가가 달라집니다. 개인 간 실거래가·보장 판매가·배터리별 정밀 보정 가격이 아닙니다.

배터리 제출은 선택입니다. 판독값의 `source: seller_screenshot`은 판매자 캡처 AI 판독이며 직접 측정이 아닙니다. 미확인은 정상으로 보지 않습니다. 기존 80% 미만 참고 플래그는 금액 보정이나 처분 분기에 사용하지 않습니다.

`assessment`의 기존 필드를 유지합니다. `disposal.action` 기본값은 `sell`, `alternatives`는 `donate/recycle`, `registrationUrl`을 추가했습니다. 과거 `sell_parts`/`donate` 보증서는 그대로 읽습니다. `DONATE_BELOW_KRW` export는 과거 코드 호환용이며 추천 분기에는 쓰지 않습니다.

실제 공개 출처에서 수집해 기존 1,784행의 참고가를 갱신했습니다. 수집 원자료와 서비스 집계를 분리하고 실패/미확인 견적은 유지합니다. 파일 갱신 시 서버가 검증 후 캐시를 자동 교체하며 기존 보증서의 발급 당시 가격은 보존합니다. `checkedOn`/원문 기준일/수집 시각을 구분합니다.

실행: `npm run price:collect`(후보만), `npm run price:daily`(검증 후 반영), `npm run price:status`(마지막 성공/실패). 예약/클라우드는 준비만 했으며 가동하지 않았습니다. 검증은 루트 `npm test`, `npm run price:validate`. [실제 결과·제한·예약/검색 실행법](PRICE_REFRESH.md), [플랫폼 인계](../common/docs/PRICE_PLATFORM_HANDOFF.md).
