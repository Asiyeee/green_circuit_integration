# ② 업체 매입 참고가 · 상태 제안 · 처리 안내

담당 영역: `lib/price.js`, `lib/assessment.js`, `prompts/assessment.*`, `data/`, `scripts/price-refresh.js`.
통합 API/화면은 ③의 `lib/seller-routes.js`, `seller.html`과 연결됩니다.

1. 점검 JSON에서 제조사·기종을 읽고 판매자가 저장 용량·외관 상태·알려진 기능 이상(없음/있음/모름)을 추가합니다. RAM과 카메라 사진 화질은 시세 조회 조건이 아닙니다.
2. 선택 사항인 외관 사진·배터리 캡처를 `/api/assess`에 보내면 Gemini가 외관을 **제안**합니다. 자동 선택하지 않으며 판매자가 확인·적용합니다. 내부 기능 정상 여부는 사진으로 판단하지 않습니다. 키 부재·실패·판단 불가에도 수동 선택과 등록이 가능합니다.
3. `brand + model_key + storage + condition_code` 정확히 일치하는 CSV만 조회합니다. 정상 기능을 전제로 하는 행은 `knownFault: none`일 때만 가격을 반환합니다. 모름을 다섯 테스트 통과로 정상으로 바꾸지 않습니다. 없으면 `no_data`, 용량 미확인은 `needs_input`, 기능 조건 미확인은 `needs_check`이며 대체 금액을 생성하지 않습니다.
4. 판매자가 정한 희망가로 우리 플랫폼에 보증서 연결 매물을 등록합니다. 파손·시세 없음·낮은 참고가만으로 판매를 배제하지 않습니다. 기부·재활용·배출 안내는 대안이며 실제 완료 기록은 별도입니다.

가격은 업체 매입 **참고가**입니다. 업체 1곳 여부는 금액이 아닌 `vendorCount`로 표시합니다. 서로 다른 업체의 원래 등급·조건·링크를 유지하며 공통 공식 등급처럼 설명하지 않습니다. `checkedOn`은 자료 확인일, `quotes[].priceDate`/`priceDateSource`는 원문 가격 기준일입니다. 배터리·잔상·수리 이력·검수 조건에 따라 실제 매입가가 달라집니다. 개인 간 실거래가·보장 판매가·배터리별 정밀 보정 가격이 아닙니다.

배터리 제출은 선택입니다. 판독값의 `source: seller_screenshot`은 판매자 캡처 AI 판독이며 직접 측정이 아닙니다. 미확인은 정상으로 보지 않습니다. 기존 80% 미만 참고 플래그는 금액 보정이나 처분 분기에 사용하지 않습니다.

`assessment`의 기존 필드를 유지합니다. `disposal.action` 기본값은 `sell`, `alternatives`는 `donate/recycle`, `registrationUrl`을 추가했습니다. 과거 `sell_parts`/`donate` 보증서는 그대로 읽습니다. `DONATE_BELOW_KRW` export는 과거 코드 호환용이며 추천 분기에는 쓰지 않습니다.

검증: 루트 `npm test`, `npm run price:validate`. [갱신 정책](PRICE_REFRESH.md), [통합 인계](../common/docs/PRICE_PLATFORM_HANDOFF.md).
