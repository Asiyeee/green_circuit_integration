> **이 폴더: ① 하드웨어 테스트** · 담당 김호준
> 파일: `index.html`(테스트 화면 `/`) · `lib/camera-profile.js` · `prompts/camera-profile.*` · `sample-result.json`(③④ 가 입력으로 쓰는 예시) · `examples/` · `summary.js`
> 카메라 Gemini 호출 서버 코드(`/api/analyze-camera`, `analyzeCamera`)와 결과 저장(`/api/report`)은 루트 `server.js` 에 있습니다 (공통).
> 결과 형식 규칙 `common/result.schema.json` · `common/scripts/validate.js` 를 바꾸면 ③ 보증서가 영향을 받으니 팀에 알리고 바꾸세요.
> 아래 문서의 `lib/`, `prompts/`, `scripts/` 경로는 합치기 전 기준입니다. 실행은 저장소 루트에서 `npm run share`.

# 기기 카메라·하드웨어 테스트 (GDGoC Hackathon Team 1) — v1

폰으로 QR 코드를 스캔하면 **카메라 · 마이크 · 스피커 · 터치 · 자이로**를 테스트하고, 결과가 **내 노트북의 `results/` 폴더에 JSON 파일로 자동 저장**됩니다.
카메라는 실제로 사진을 찍게 한 뒤 Gemini AI가 **화질 평가 + 카메라 성향 프로필**(등급, 성능 점수, 빈티지 같은 "느낌", 잘 맞는 용도, 결함)을 만들어 줍니다.

> 서비스 목적: 카메라로 쓸 **공기계(중고폰)** 를 찾는 사람이 "성능"과 "느낌"으로 기기를 고를 수 있게 하는 것.
> 이 테스트 페이지는 그 데이터를 만드는 **입력 단계**이고, 만들어진 JSON을 다음 단계(추천/검색/DB)가 가져다 씁니다.

## 처음 받았다면

| 나는 | 읽을 문서 |
|---|---|
| **④ 구매자 파트 개발자** | [docs/HANDOFF_BUYER.md](docs/HANDOFF_BUYER.md) — 10분 시작, 데모 데이터(`npm run seed`), 쓸 API |
| ③ 판매자 보증서가 궁금함 | [docs/SELLER_CERTIFICATE.md](docs/SELLER_CERTIFICATE.md) — 보증서 JSON, 시세·탄소·환경 온도 규칙 |
| ① 웹 테스트를 돌려 보고 싶음 | 아래 1~5장 |

```bash
npm install && cp .env.example .env
npm run seed     # 폰 없이 데모 보증서 9장
npm start        # http://localhost:3000/api/public/certificates
```

```
[폰 브라우저] ──HTTPS(cloudflared 터널)──> [내 노트북: server.js] ──> Gemini API
                                                  │
                                                  └─> results/latest.json  ← 팀원이 가져다 쓰는 파일
```

Gemini 키는 노트북의 `.env` 파일에만 있고, 폰이나 브라우저로는 절대 나가지 않습니다.

---

## 목차
1. [준비물 설치](#1-준비물-설치-처음-한-번만)
2. [레포 받고 키 넣기](#2-레포-받고-gemini-키-넣기)
3. [서버 켜고 QR 띄우기](#3-서버-켜고-qr-띄우기)
4. [폰으로 테스트하기](#4-폰으로-테스트하기)
5. [결과 확인하기](#5-결과-확인하기)
6. [JSON 설명서 (다음 단계 담당자용)](#6-json-설명서-다음-단계-담당자용)
7. [JSON을 코드에서 쓰는 법](#7-json을-코드에서-쓰는-법)
8. [다음 단계로 넘기는 법](#8-다음-단계로-넘기는-법)
9. [알려진 한계](#9-알려진-한계-꼭-읽어-주세요)
10. [문제 해결](#10-문제-해결)
11. [Gemini 프롬프트/모델 바꾸기](#11-gemini-프롬프트모델-바꾸기)
12. [파일 구성 · 보안](#12-파일-구성--보안)

---

## 1. 준비물 설치 (처음 한 번만)

**터미널 여는 법**: macOS는 `Cmd+Space` → "터미널" / Windows는 시작 메뉴 → "PowerShell". 아래 명령어는 전부 터미널에 붙여 넣고 Enter를 누릅니다.

| 준비물 | 용도 | 설치 | 확인 |
|---|---|---|---|
| **Node.js 20 이상** | 서버 실행 | https://nodejs.org 에서 **LTS** 다운로드 후 설치 | `node --version` → `v20` 이상 |
| **git** | 레포 받기 | macOS: 터미널에 `git --version` 치면 설치 안내가 뜸 / Windows: https://git-scm.com | `git --version` |
| **cloudflared** | 폰이 내 노트북에 HTTPS로 접속하는 터널 | macOS: `brew install cloudflared` / Windows: `winget install --id Cloudflare.cloudflared` | `cloudflared --version` |
| **Gemini API 키** | 사진 분석 | https://aistudio.google.com → **Get API key** → 키 복사 | (다음 단계에서 사용) |

- macOS에 `brew`가 없다면 https://brew.sh 안내대로 먼저 설치하세요.
- Windows에서 cloudflared 설치 후에는 **PowerShell을 닫았다가 다시 열어야** 인식됩니다.
- 노트북과 폰이 같은 와이파이일 필요는 **없습니다** (터널이 인터넷으로 연결해 줍니다).
- 폰은 **iPhone(Safari)** 또는 **Android(Chrome)** 를 쓰세요.

> **왜 HTTPS 터널이 필요한가요?** 브라우저는 카메라·마이크·자이로 같은 민감한 기능을 HTTPS 페이지에서만 허용합니다. 노트북의 `http://192.168...` 주소로는 폰에서 카메라가 켜지지 않아서, cloudflared가 임시 HTTPS 주소를 만들어 줍니다.

## 2. 레포 받고 Gemini 키 넣기

```bash
git clone https://github.com/hojune02/gdgoc_hackathon_team1.git
cd gdgoc_hackathon_team1
npm install
```
`npm install`은 QR을 터미널에 그려 주는 작은 라이브러리 1개만 설치합니다.

키 파일 만들기:
```bash
cp .env.example .env          # Windows PowerShell:  copy .env.example .env
```
`.env` 파일을 메모장/VS Code로 열어 `GEMINI_API_KEY=` 바로 뒤에 키를 붙여 넣고 저장합니다.
```
GEMINI_API_KEY=AIza............
```
> ⚠️ **키를 절대 커밋/공유하지 마세요.** `.env`는 `.gitignore`에 들어 있어 git에 올라가지 않습니다. 이 레포는 public이라, 한 번이라도 올라가면 바로 노출됩니다. 키를 채팅/코드/스크린샷에 붙이지 마세요.

## 3. 서버 켜고 QR 띄우기

```bash
npm run share
```
잘 되면 터미널에 이런 것들이 나옵니다.
- `✔ Gemini 키/모델 확인 OK (model: ...)` ← 키와 모델이 맞다는 뜻
- **QR 코드**와 `https://xxxx.trycloudflare.com/?t=...` 주소

`✖ Gemini 확인 실패`가 나오면 [문제 해결](#10-문제-해결)을 보세요. 이 터미널 창은 **테스트하는 동안 계속 켜 둡니다**(끄려면 `Ctrl+C`). 실행할 때마다 QR/주소가 새로 바뀝니다.

## 4. 폰으로 테스트하기

1. 폰 **카메라 앱으로 QR을 스캔**해서 열립니다. 상단 "서버"가 **연결됨**이어야 정상입니다. (주소가 열리지 않으면 10초쯤 기다렸다가 다시 시도)
2. **📱 테스트하는 기기**에서 지금 쓰는 폰의 **제조사 → 모델**을 고릅니다. 목록에 없으면 "목록에 없음(직접 입력)". 이 값은 JSON에 기록되어 나중에 "이 결과가 어떤 폰의 것인지" 연결하는 데 쓰입니다. (이름도 적어 두면 파일 이름에 들어갑니다)
3. 위에서 아래로 차례로 진행합니다. 권한 팝업은 **모두 허용**하세요.

| 항목 | 하는 일 |
|---|---|
| 📷 카메라 | **① 카메라 확인** → **② 사진 촬영**. 밝은 곳에서 **글씨가 있는 종이나 디테일이 있는 물체**를 가까이서 찍어 주세요. 사진을 찍으면 AI 분석이 백그라운드로 돌아갑니다("AI 분석 중" 표시). **기다리지 말고 아래 항목을 먼저 진행**하세요. |
| 🎤 마이크 | 시작 누르고 5초 동안 말하거나 박수 |
| 🔊 스피커 | 소리가 나면 "들렸어요" |
| ✋ 터치 | 12개 칸을 모두 눌러 보기 (여러 손가락으로 동시에 눌러 보면 멀티터치도 기록됩니다) |
| 🧭 자이로 | 권한 허용 후 폰을 이리저리 돌리기 |

4. **5개 항목이 모두 끝나면 자동 저장**됩니다. 화면에 `✅ 서버에 저장됨: results/...`가 뜨고, 노트북 터미널에도 `✔ 저장됨 ...`이 나옵니다.

> 같은 페이지에서 다시 테스트하면 같은 파일을 덮어씁니다. **페이지를 새로고침하면 새 테스트(새 파일)** 가 됩니다. 다른 폰을 테스트할 때는 그 폰에서 QR을 다시 스캔하면 됩니다.

## 5. 결과 확인하기

노트북 터미널에서 (서버를 켠 창과는 **다른 새 터미널**, 같은 폴더에서):

```bash
npm run summary      # 사람이 읽기 쉬운 요약
npm run validate     # JSON이 약속된 형식을 지키는지 검사
```
파일은 `results/` 폴더에 있습니다.
```
results/latest.json                          항상 가장 최근 결과 (이 파일을 가져다 쓰세요)
results/2026-11-01T14-22-21_홍길동_f998b886.json   테스트마다 하나씩 쌓이는 기록
results/2026-11-01T14-22-21_홍길동_f998b886.jpg    그때 찍은 사진
```
`results/`는 git에 올라가지 않습니다. 팀에 공유하려면 [8장](#8-다음-단계로-넘기는-법)을 보세요.

**폰 없이 먼저 개발하고 싶다면** 레포의 [`sample-result.json`](sample-result.json)을 입력으로 쓰세요. 실제 결과와 구조가 같습니다.

---

## 6. JSON 설명서 (다음 단계 담당자용)

형식 이름은 `device-hw-test/v1`입니다. 정식 정의는 [`result.schema.json`](result.schema.json)(JSON Schema)에 있습니다.

### 큰 구조
```
schema        "device-hw-test/v1"  (항상 이 값. 다르면 처리하지 마세요)
sessionId     테스트 1회의 고유 ID
testedAt      시각 (ISO 8601, UTC)
tester        입력한 이름 (없으면 null)
device        접속한 기기 정보 + device.declared(사용자가 고른 기종)
results       camera / microphone / speaker / touch / gyro  각각 { status, ... }
summary       항목별 status + completed(5개 모두 끝남) + allPassed(5개 모두 pass)
```
`status`는 `pass` / `fail` / `unsupported` / `pending` 중 하나입니다. **세부 필드를 읽기 전에 `status`부터 확인**하세요. `fail`/`unsupported`이면 세부 필드가 없을 수 있고 `error`에 이유가 있습니다.

### 어떤 폰의 결과인지: `device.declared`
```json
"declared": { "brand": "Apple", "model": "iPhone 13 Pro", "source": "dropdown", "matchesUserAgent": true }
```
- 사용자가 드롭다운에서 고른 값이라 **검증되지 않은 값**입니다. 다른 데이터와 연결하는 키로 쓰되, `matchesUserAgent`가 `false`이면(예: iPhone으로 접속했는데 Galaxy를 고름) 의심하세요.
- `source`: `dropdown`(목록에서 고름) / `typed`(직접 입력) / `user-unknown`(모르겠음). 선택 안 했으면 `declared` 자체가 `null`.
- **iOS는 웹에서 정확한 기종을 알려주지 않기 때문에** 이 값이 사실상 유일한 기종 정보입니다. (Android Chrome도 기종 정보를 가립니다.)

### 항목별 주요 필드
| 항목 | 주요 필드 |
|---|---|
| `camera` | `stream`(라벨, 줌 범위 등), `photo`(해상도·EXIF·측정값·QA), **`profile`**(AI 카메라 프로필), `checks`(대조 결과), `verdictBasis` |
| `microphone` | `peakDb`, `avgDb`, `noiseFloorDb`, `sampleRate` |
| `speaker` | `userConfirmed`, `baseLatencyMs` |
| `touch` | `cellsHit`, `maxSimultaneousTouches`, `multiTouchDetected` |
| `gyro` | `orientationEvents`, `maxOrientationRangeDeg`, `maxAccelRange`, `permission` |

### 카메라 프로필: `results.camera.profile`
Gemini가 사진 1장과 메타데이터를 보고 만든 **구매자용 프로필**입니다. Gemini가 실패했거나 키가 없으면 `null`입니다(항상 확인하세요).

| 필드 | 설명 |
|---|---|
| `grade` | `S` `A` `B` `C` `D` — 이 사진 기준 화질 등급 |
| `summary_ko` | 구매자용 2~3문장 요약 |
| `scores` | `sharpness` `noise_cleanliness` `dynamic_range` `exposure_accuracy` `color_accuracy` `low_light_potential` — 1~10 정수, 높을수록 좋음, 판단 불가면 `null` |
| `look` | **느낌**: `style_tags`(`vintage` `film_like` `digicam_ccd` `soft_dreamy` `high_contrast` `muted` `vivid` `warm_tone` `cool_tone` `grainy` `clean_modern` `crisp_digital` `hdr_processed`), `vintage_score`(1~10), `warmth`(-5 차가움 ~ +5 따뜻함), `saturation`, `contrast`, `grain`, `softness`, `vignetting`, `feel_ko` |
| `optics` | `focal_length_35mm_equiv` `aperture_f` `iso` `shutter_s` — **EXIF가 있을 때만** 값이 있고, 없으면 `null` |
| `defects` | 렌즈 오염, 흔들림, 보라 프린지 등 (없으면 `["none"]`) |
| `best_for` / `not_ideal_for` | 잘 맞는/아쉬운 용도: `street_snap` `portrait` `landscape` `night_lowlight` `closeup_macro` `document_text` `vlog_video` `travel` `pet_kids` `food` `social_feed` `film_look_project` |
| `confidence`, `caveats_ko` | 분석 신뢰도(`low`/`medium`/`high`)와 한계 설명 |

- **enum 값은 항상 영어 코드**입니다. 화면용 한글 라벨은 `index.html`의 `L` 객체에 있습니다.
- 서버가 Gemini 출력을 한 번 정리해서 줍니다(점수는 1~10 정수로, 허용되지 않은 값은 제거).

### 이 값들을 얼마나 믿을 수 있나

| 신뢰도 | 필드 | 이유 |
|---|---|---|
| **높음** | `device.*`, `photo.resolution`, `photo.localMetrics`, `microphone`/`touch`/`gyro` 수치, EXIF가 있을 때의 `optics` | 브라우저/기기가 직접 측정한 값 |
| **중간** | `scores.sharpness/noise/exposure`, `defects`, `qa` | AI가 사진 1장을 보고 판단. 장면(조명·피사체)의 영향을 받음 |
| **낮음** | `grade`, `look.*`(빈티지 등 취향 항목), `best_for` | 정답이 없는 주관적 판단. 같은 사진도 실행마다 ±1~2 흔들릴 수 있음 |

그래서 **`checks`와 `confidence`를 같이 보세요.**

`results.camera.checks` — 서버가 AI 결과를 확실한 정보와 대조한 결과:
| 필드 | 뜻 |
|---|---|
| `exif_present` | 사진에서 EXIF를 읽었는가 |
| `declared_device_given` / `declared_matches_user_agent` | 기종을 골랐는가 / 접속한 기기와 모순 없는가 |
| `exposure_consistent_with_local` | AI의 노출 판정이 실제 측정한 밝기와 맞는가 |
| `sharpness_consistent_with_local` | AI의 선명도 판정이 실제 측정값과 모순되지 않는가 |
| `warnings` | 어긋난 항목 설명. **하나라도 있으면 `profile.confidence`는 `low`** |

## 7. JSON을 코드에서 쓰는 법

**가장 쉬운 방법**: 파일을 읽으면 됩니다. 아래 예제 파일은 설치 없이 바로 돌아갑니다.
```bash
node examples/read-result.js sample-result.json      # Node
python3 examples/read_result.py sample-result.json   # Python
node examples/list-all.js                            # results/ 의 모든 결과를 표로 (--csv 로 CSV 출력)
```
파일 이름을 안 주면 `results/latest.json`을 읽습니다.

Python 최소 예:
```python
import json
r = json.load(open("results/latest.json", encoding="utf-8"))
assert r["schema"] == "device-hw-test/v1"
if r["results"]["camera"]["status"] == "pass":
    p = r["results"]["camera"]["profile"]        # None 일 수 있음!
    if p:
        print(p["grade"], p["look"]["vintage_score"], [b["use"] for b in p["best_for"]])
```
JavaScript 최소 예:
```js
const r = JSON.parse(require("fs").readFileSync("results/latest.json", "utf8"));
const p = r.results.camera.profile;               // null 일 수 있음
const sharp = p?.scores.sharpness ?? 0;           // 점수는 null 일 수 있으니 기본값을 주세요
```
서버가 켜져 있으면 HTTP로도 읽을 수 있습니다 (`?t=` 뒤의 토큰은 서버를 켤 때 터미널에 나온 값):
```bash
curl "http://localhost:3000/api/results/latest?t=<토큰>"
```

### 지켜야 할 규칙
1. **필드는 추가만 합니다.** 이름 변경/삭제가 필요하면 `schema`를 `device-hw-test/v2`로 올리고, `sample-result.json`과 `result.schema.json`을 같이 고치세요.
2. 값이 `null`일 수 있는 필드(`profile`, 점수, `optics`, `declared`)는 항상 null 처리를 하세요.
3. 항목별 세부 필드는 그 항목 담당자가 관리합니다. 바꾸면 `sample-result.json`도 같이 고치고 `npm run validate -- sample-result.json`으로 확인하세요.

## 8. 다음 단계로 넘기는 법

1. **데이터 모으기**: 여러 폰을 테스트해서 `results/`에 쌓습니다. 한 번에 보려면 `node examples/list-all.js`.
2. **팀에 공유하기**: `results/`는 git에 안 올라갑니다. 공유할 결과는 레포 안에 `fixtures/` 폴더를 만들어 JSON(과 사진)을 복사한 뒤 커밋하세요. 사진에 사람 얼굴이나 개인정보가 찍히지 않았는지 확인하세요. 또는 Slack/드라이브로 파일을 보내도 됩니다.
3. **기종과 연결하기**: `device.declared.brand + model`이 "어떤 폰의 카메라인지"를 나타내는 키입니다. 같은 기종을 여러 번 테스트했다면 `grade`/`scores`를 평균 내거나 `confidence`가 높은 것만 쓰세요.
4. **추천/검색에 쓰기 (예)**: "빈티지한 느낌 + 선명도 7 이상" → `look.vintage_score >= 6 && scores.sharpness >= 7`. `examples/read-result.js`에 구현되어 있습니다.
5. **프로필 항목을 늘리고 싶다면** [11장](#11-gemini-프롬프트모델-바꾸기)을 보세요.

## 9. 알려진 한계 (꼭 읽어 주세요)

- **iPhone에서는 ISO·셔터·조리개·초점거리(EXIF)를 얻을 수 없습니다.** iPhone Safari에서 촬영과 앨범 선택 두 경로를 모두 확인했는데, iOS가 웹으로 사진을 넘길 때 카메라 정보를 지웁니다(`photo.exifStatus`가 `exif_without_camera_tags`). 이때 `profile.optics`의 수치는 `null`이고 `confidence`는 `high`가 될 수 없습니다. 대신 `camera.stream`(렌즈 라벨, 줌 범위 0.5~10이면 초광각 있음 등)과 사진 자체로 판단합니다. **Android Chrome에서는 다를 수 있으니 Android 팀원이 한 번 확인해 주세요**(`exifStatus`가 `ok`면 성공).
- **사진 1장으로는 저조도·줌 성능을 알 수 없습니다.** `low_light_potential`이 `null`인 이유입니다. 여러 장 촬영(밝은 곳/어두운 곳/줌) 방식은 v2 후보입니다.
- **같은 사진도 AI 점수가 조금 흔들립니다.** 특히 빈티지 같은 취향 항목은 참고용입니다.
- **기종은 사용자가 고른 값**이라 틀릴 수 있습니다.
- Gemini가 일시적으로 몰리면 `503`이 날 수 있습니다. 모델을 바꾸면 해결됩니다(10장).
- 서버 모드가 아닌 단독 페이지(서버 없이 index.html만 연 경우)는 간단한 화질 평가만 되고 자동 저장·프로필이 없습니다.

## 10. 문제 해결

| 증상 | 해결 |
|---|---|
| `cloudflared 가 설치되어 있지 않습니다` | 1장에서 cloudflared 설치. Windows는 터미널을 껐다 켜기 |
| `npm: command not found` / `node: command not found` | Node.js 설치 후 터미널을 껐다 켜기 |
| 폰에서 QR 주소가 안 열림 | 터널 연결에 10초쯤 걸립니다. 잠시 후 다시. 서버를 다시 켰다면 **새 QR**로 접속 |
| 화면에 "토큰 필요" | 주소의 `?t=...`가 빠졌습니다. QR로 다시 접속 |
| 화면에 "서버 없음" | 서버 없이 정적 페이지로 열린 경우입니다. `npm run share`로 연 주소로 접속 |
| `✖ Gemini 확인 실패 HTTP 404` | 모델 이름이 틀림. `npm run models`로 목록 확인 → `.env`의 `GEMINI_MODEL` 수정 |
| `HTTP 400/403` (서버 로그에 `424`) | 키가 틀렸거나 제한이 걸림. `.env`의 키 확인 (따옴표/공백 없이) |
| `HTTP 429` | 무료 쿼터 초과. 잠시 후 다시 |
| `HTTP 503 ... high demand` | 구글이 몰린 상태. `.env`의 `GEMINI_MODEL`을 바꾸세요 (예: `gemini-flash-lite-latest` ↔ `gemini-flash-latest` ↔ `gemini-2.5-flash-lite`). 바꾼 뒤 서버를 껐다 켜기 |
| 첫 요청에 `Gemini 400 (... ) → 다음 방식으로 재시도` 가 한 번 나옴 | 정상입니다. 모델이 받는 설정을 찾는 과정이고, 이후엔 한 번에 성공합니다 |
| `profile`이 `null`, `verdictBasis`가 `local-heuristic` | Gemini가 실패했거나 키가 없음. `photo.geminiError`와 서버 터미널의 `Gemini ...` 줄 확인 |
| `photo.exif`가 `null` | iPhone이면 정상입니다 (9장). Android도 그렇다면 `photo.exifStatus`와 `exifTagIds`를 팀에 공유 |
| iOS 자이로 권한이 안 뜸 | Safari를 완전히 종료하고 QR 다시 스캔 |
| 포트 사용 중 | `.env`에 `PORT=3001` 추가 |
| 터치 칸이 안 눌림 | 화면을 스크롤하지 말고 칸을 정확히 눌러 보세요 |
| 5개를 다 했는데 저장이 안 됨 | 카메라가 "AI 분석 중"이면 끝날 때까지 기다리세요(보통 5~10초, 최대 1분). 그래도 안 되면 하단의 "JSON 다운로드" 버튼으로 직접 저장 |

## 11. Gemini 프롬프트/모델 바꾸기

| 바꾸고 싶은 것 | 고칠 파일 | 서버 재시작 |
|---|---|---|
| 평가 기준·말투·등급 기준 | `prompts/camera-profile.system.md` | 필요 없음 (요청마다 읽음) |
| 출력 항목/값 추가 | `prompts/camera-profile.schema.json` → `lib/camera-profile.js`의 정리 함수 → `result.schema.json`, `sample-result.json` | 필요 |
| 화면 한글 라벨 | `index.html`의 `L` 객체 | 새로고침 |
| 드롭다운 폰 목록 | `index.html`의 `PHONES` 객체 | 새로고침 |
| 모델/속도 설정 | `.env` | 필요 |

- 프롬프트는 서버에만 있습니다. 브라우저는 사진과 메타데이터만 보내며, 임의의 프롬프트를 보낼 수 없습니다.
- 새 enum 값(예: 스타일 태그)을 추가하면 스키마 파일 + `index.html`의 `L` 라벨을 같이 추가하세요.
- **모델**: 기본은 `gemini-flash-lite-latest`(빠름). `npm run models`로 내 키로 쓸 수 있는 목록을 봅니다. 느리거나 503이 나면 다른 모델로 바꿔 보세요.
- **속도**: 서버가 모델에 맞는 가장 빠른 방식을 자동으로 고릅니다(생각 끄기 → `thinkingLevel: low` → 스키마만 → 프롬프트만). 응답이 20초 넘으면 같은 요청을 한 번 더 보내 먼저 오는 쪽을 씁니다. 터미널의 `Gemini 200 (4737ms ...)` 줄에서 걸린 시간을 볼 수 있습니다.
- `.env` 옵션: `GEMINI_THINKING`(`auto` 기본 / `default` / 숫자), `GEMINI_HEDGE_MS`(기본 20000, 0이면 끔), `PORT`, `ACCESS_TOKEN`.
- **서버가 AI 결과를 고치는 규칙** (`lib/camera-profile.js`의 `applyChecks`): EXIF가 없으면 `optics` 수치를 모두 `null`로 만들고(모델이 지어낸 값 제거), EXIF가 있으면 EXIF 값으로 덮어씁니다. 측정값과 어긋나면 `checks.warnings`에 남기고 `confidence`를 `low`로 내립니다.

## 12. 파일 구성 · 보안

```
index.html              테스트 페이지 (폰에서 열림)
server.js               페이지 제공 + Gemini 호출 + 결과 저장 API
prompts/                Gemini 시스템 프롬프트와 출력 스키마 (팀이 같이 다듬는 곳)
lib/camera-profile.js   Gemini 출력 정리 + EXIF/측정값 대조
scripts/share.js        서버 + cloudflared 터널 + QR   (npm run share)
scripts/summary.js      결과 요약 보기                  (npm run summary)
scripts/validate.js     결과 JSON 형식 검사             (npm run validate)
scripts/models.js       쓸 수 있는 Gemini 모델 목록     (npm run models)
examples/               JSON을 읽는 예제 (Node, Python, 전체 표)
sample-result.json      샘플 결과 (폰 없이 개발할 때)
result.schema.json      결과 JSON의 정식 형식(JSON Schema)
.env.example            환경변수 양식 (.env 로 복사)
results/                결과 저장 폴더 (자동 생성, git 제외)

assets/ui.css           공통 디자인 시스템 (세 화면이 함께 씀)

③ 판매자 보증서 (docs/SELLER_CERTIFICATE.md)
seller.html             보증서 발급 페이지 (/seller)
certificate.html        보증서 공개 페이지 (/c/{id})
lib/seller-routes.js    보증서 API
lib/price.js            시세 조회 (data/중고폰_시세_통합.csv)
lib/carbon.js           탄소 영수증 (data/device-carbon.json)
lib/eco-temperature.js  환경 온도 규칙
lib/certificate.js      보증서 JSON 생성·무결성·요약
lib/certificate-store.js 저장소 (store/ 또는 Firestore)
data/                   시세 CSV, 처리 매뉴얼, 기종별 탄소 데이터
sample-certificate.json 샘플 보증서
store/                  보증서 저장 폴더 (자동 생성, git 제외)
```

**보안**
- `/api/*`는 서버를 켤 때마다 새로 만들어지는 토큰이 있어야만 동작합니다. QR/URL을 아무에게나 공유하지 마세요(내 Gemini 쿼터를 쓰게 됩니다). 테스트가 끝나면 `Ctrl+C`로 서버를 끄세요.
- Gemini 호출은 분당 20회로 제한됩니다.
- 결과 JSON에는 기기 식별자(`deviceId`)를 넣지 않습니다. 사진 파일에는 찍힌 내용이 그대로 들어 있으니, 공유 전에 확인하세요.
- 토큰을 고정하고 싶으면 `.env`에 `ACCESS_TOKEN=원하는값`.
