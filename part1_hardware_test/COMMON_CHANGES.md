# ① 하드웨어 테스트 개선 — 공통 부분 영향 정리 (2026-11-03)

담당: 김호준 · 반영한 피드백: 마이크·스피커 정밀 측정 / 카메라 촬영 지시(밝기 조절 등) / 터치 전체 화면 팝업

## 한 줄 요약

**`common/`, 루트 `server.js`, 다른 파트(②③④) 파일은 하나도 수정하지 않았습니다.**
바뀐 파일은 전부 `part1_hardware_test/` 안에 있고, 결과 JSON(`device-hw-test/v1`)은 **필드 추가만** 했습니다. 기존 필드 이름·의미는 그대로라 ③ 보증서·④ 구매자 화면은 지금 코드 그대로 동작합니다.

| 수정한 파일 (모두 part1) | 내용 |
|---|---|
| `index.html` | 카메라 촬영 가이드·코칭·어두운 곳 테스트, 마이크 2단계 측정, 스피커 횟수 맞히기 + 음역대 자동 측정, 전체 화면 터치 |
| `prompts/camera-profile.system.md` | `capture_context`(메인 / 저조도 사진) 규칙 추가 — 밝은 사진에 '야간·저조도'를 근거 없이 붙이지 않게 |
| `lib/camera-profile.js` | `applyChecks` 에 저조도 안전장치 추가, `checks` 에 필드 2개 추가 |
| `sample-result.json` | 새 필드 예시 반영 (`npm run validate -- part1_hardware_test/sample-result.json` 통과) |
| `summary.js` | 새 측정값 출력 |
| `README.md` | 4·6·9·10장 갱신 |

## 공통 파일을 안 고쳐도 되는 이유 (확인한 것)

| 공통 파일 | 확인 결과 |
|---|---|
| `common/result.schema.json` | `additionalProperties` 제한이 없어 새 필드가 있어도 형식 위반이 아님 |
| `common/scripts/validate.js` | 항목별 `status` 와 최상위 필드만 검사 → 새 결과 그대로 통과 (실제로 저장된 결과로 확인) |
| `server.js` `/api/analyze-camera` | 브라우저가 보낸 `metadata` 를 그대로 Gemini 에 넘김 → 새 `metadata.capture_context` 가 추가 수정 없이 전달됨. 저조도 사진 분석도 같은 API 를 한 번 더 부르는 방식 |
| `server.js` `/api/report` | 변경 없음. 메인 사진만 `.jpg` 로 저장 (저조도 사진 원본은 저장하지 않고 측정값만 JSON 에 남김) |
| `part3_certificate/lib/certificate.js` | 새 결과 JSON 으로 `build()` 를 돌려 확인: 마이크 `peakDb`·`noiseFloorDb`, 스피커 `userConfirmed`, 터치 `cellsHit`·`cellsTotal`·`maxSimultaneousTouches` 모두 정상으로 읽힘 |

## 다른 파트가 알아 둘 의미 변화 (이름은 같음)

| 필드 | 전 | 지금 |
|---|---|---|
| `touch.cellsTotal` | 항상 `12` | **화면 크기에 따라 다름** (390×844 폰 기준 7×14 = `98`). 보증서의 `98/98칸` 표시는 그대로 맞게 나옴. `=== 12` 로 비교하는 코드는 없음(확인함) |
| `touch.status` | 12칸 다 누를 때만 `pass`, 실패 기록 없음 | 전부 칠하면 `pass`, 중간에 '여기서 끝내기' 하면 **`fail`** + `missedCells` 위치 기록 |
| `speaker.userConfirmed` | "들렸어요" 버튼 | **무작위 2~5번 삐 소리 횟수를 맞혔는가** (더 엄격) |
| `microphone.noiseFloorDb` | 5초 측정 중 하위 10% 값 | **'조용히' 단계에서 잰 잡음의 중앙값** (더 정확). 잡음을 완전히 잘라 내는 기기는 `-140` 처럼 아주 낮게 나올 수 있음 (`quality.noiseGateSuspected: true`) |
| `microphone.status` | 최대 음량 > -50dB 이면 `pass` | 위 조건 **+ 목소리가 잡음보다 10dB 이상 큼** |
| `camera.profile.scores.low_light_potential`, `not_ideal_for` | 사진 1장으로 AI 가 추정 | 밝은 메인 사진이면 `null` / '야간·저조도' 제거. **어두운 곳 테스트를 하면** 그 점수로 채워짐 (`profile.lowLightSource: "extra_photo"`) |

## 새로 추가된 필드

```
results.camera.coaching[]          {code, level: warn|info, title_ko, text_ko}  촬영 코칭 (code 예: too_dark, too_bright, shake, focus, lens_dirty, flat_subject, lowlight_untested)
results.camera.lowLight            null | {status, score 1-10, scoreSource: gemini|local-heuristic, localScore, noise_cleanliness, sharpness, defects, summary_ko, photo{...}}
results.camera.photo.localMetrics.noiseSigma     노이즈 추정값(밝기 0~255 기준 표준편차)
results.camera.checks.capture_purpose            "main"
results.camera.checks.lowlight_claim_removed     서버가 근거 없는 '야간·저조도'를 뗐는가
results.camera.profile.lowLightSource            "extra_photo" (어두운 곳 테스트 반영 시)

results.microphone.quality         {grade A-D, snrDb, noiseGateSuspected, speechLevelDb, voicedPct, clippingPct,
                                    dropoutFrames, bands[{band, hz, levelDb, snrDb}], issues[], userPlayback: clear|noisy|null, method}

results.speaker.countTest          {played, answered, attempts, correct}
results.speaker.loopback           {status: ok|error|unsupported, tones[{hz, levelDb, snrDb, detected}], detectedCount, total,
                                    grade A-D, midSpreadDb, detectThresholdDb, method}   (자동 측정을 안 했으면 없음)

results.touch.mode                 "fullscreen-grid"
results.touch.grid                 {cols, rows, cellPx}
results.touch.missedCells[]        {row, col}  (0부터, 왼쪽 위가 0,0)
results.touch.missedEdgeCells, coveragePct, viewport, fullscreenApi, durationMs, completeMs, events
```

전체 예시는 `part1_hardware_test/sample-result.json`.

## 공통·다른 파트에 제안 (선택, 제가 고치지 않음)

담당자가 원할 때만 하면 됩니다. 안 해도 아무것도 깨지지 않습니다.

1. **`common/result.schema.json` (전원)**: 새 필드를 문서로 남기고 싶다면 `microphone.properties` 에 `quality`, `speaker.properties` 에 `countTest`·`loopback`, `touch.properties` 에 `mode`·`grid`·`missedCells`, `camera.properties` 에 `coaching`·`lowLight` 를 `"type": "object"` / `"array"` 로 추가. 모두 선택 필드라 `required` 에는 넣지 않습니다.
2. **③ 보증서 표시 (송영찬)**: `part3_certificate/lib/certificate.js` 의 `summarizeTest` 가 지금은 새 필드를 보증서에 옮기지 않습니다. 넣는다면 예: 마이크 `quality.grade`(음질 등급), 스피커 `loopback.grade`·`detectedCount`(음역대), 터치 `missedEdgeCells`, 카메라 `lowLight.score`(저조도 점수). 화면 문구는 `certificate.html` 106~108행 근처.
3. **루트 `README.md` (전원)**: "다음 할 일" 의 ① 항목(마이크·스피커 정밀 측정, 카메라 촬영 가이드, 전체 화면 터치)은 이번에 반영됨.

## 확인한 방법

- 서버(`node server.js`, Gemini 키 없이)를 띄우고 헤드리스 Chromium(가짜 카메라·마이크, 390×844 터치 화면)으로 5개 항목을 끝까지 진행 → 자동 저장 → `npm run validate` 통과.
- 터치: 실제 터치 이벤트로 98칸 칠하기 + 두 손가락 동시 터치 → `pass` / 중간 종료 → `fail` + 빨간 칸 기록.
- 카메라: 어두운 흐린 사진 → `too_dark`·`focus` 코칭, 어두운 방 사진 → 저조도 점수 반영.
- `applyChecks` 단위 확인: 밝은 메인 사진의 '야간·저조도' 제거, 저조도 사진에서는 그대로 유지.
- **실기기 확인이 아직 필요**: iPhone Safari / Android Chrome 에서 마이크 등급 기준값(`MIC_MIN_SNR_DB`)과 스피커 자동 측정 감지율. 기준값은 `index.html` 상단 상수에서만 바꾸면 됩니다.
