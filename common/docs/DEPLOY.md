# Cloud Run 배포

시세 일별 Job/영구 원본/예약은 [별도 수집 운영 인계](../../part2_price_disposal/PRICE_REFRESH.md)의 템플릿과 환경변수를 함께 확인하세요. 기본 이미지의 CSV만 읽는 구성과 Cloud Storage 원본을 동기화하는 구성은 다릅니다. 이번 개발 작업에서는 아래 배포 명령이나 원격 설정 변경을 실행하지 않았습니다.

서버 하나에 ①~④가 모두 들어 있습니다. 배포하면 고정 HTTPS 주소가 생겨서 폰 센서·카메라가 노트북 없이 동작합니다.

| 화면 | 주소 | 토큰 |
|---|---|---|
| ① 하드웨어 테스트 | `https://<서비스 주소>/?t=<토큰>` | 필요 |
| ②③ 판매자 (AI 판별·시세·보증서 발급) | `/seller?t=<토큰>` | 필요 |
| ③ 보증서 | `/c/<id>` | 없음 |
| ④ 구매자 추천 | `/buyer` | 없음 |

저장소: 배포 환경은 `STORE=firestore` (테스트 결과 `reports`, 보증서 `certificates`, 사진, 사용자). 노트북은 그대로 `results/`, `store/` 폴더.

## 0. 처음 한 번 (Windows PowerShell)

1. [Google Cloud 콘솔](https://console.cloud.google.com)에서 프로젝트 만들기 → 결제 계정 연결 (Cloud Run 은 결제 계정이 있어야 켜지며, 데모 수준은 무료 사용량 안)
2. [gcloud CLI 설치](https://cloud.google.com/sdk/docs/install) 후:

```powershell
gcloud auth login
gcloud config set project <프로젝트ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com secretmanager.googleapis.com
gcloud firestore databases create --location=asia-northeast3
```

3. Gemini 키를 Secret Manager 에 넣고, Cloud Run 이 읽을 수 있게 권한 주기:

```powershell
"<GEMINI_API_KEY 값>" | gcloud secrets create gemini-api-key --data-file=-
$num = gcloud projects describe <프로젝트ID> --format="value(projectNumber)"
gcloud secrets add-iam-policy-binding gemini-api-key --member="serviceAccount:$num-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
```

## 1. 배포 (코드 바꿀 때마다)

저장소 루트(`server.js` 가 있는 곳)에서:

```powershell
gcloud run deploy green-circuit --source . --region asia-northeast3 --allow-unauthenticated `
  --set-env-vars "STORE=firestore,ACCESS_TOKEN=<팀이 정한 긴 토큰>" `
  --set-secrets "GEMINI_API_KEY=gemini-api-key:latest" `
  --max-instances 1 --memory 512Mi
```

- 끝나면 `Service URL: https://green-circuit-xxxx.a.run.app` 이 나옵니다.
- `ACCESS_TOKEN` 을 고정해야 재시작해도 링크(`?t=`)가 유지됩니다. 영문·숫자 20자 이상 권장.
- `--max-instances 1`: AI 판별 결과를 서버 메모리에 잠시 두기 때문 (인스턴스가 여러 개면 발급 때 다시 판별해서 동작은 하지만 Gemini 호출이 늘어남).
- `.env`, `store/`, `results/` 는 `.gcloudignore` 로 올라가지 않습니다.

## 2. 데모 매물 넣기 (선택)

노트북에서 Firestore 로 바로 씁니다:

```powershell
gcloud auth application-default login
$env:STORE="firestore"; $env:FIREBASE_PROJECT_ID="<프로젝트ID>"; npm run seed
Remove-Item Env:STORE; Remove-Item Env:FIREBASE_PROJECT_ID
```

`--reset` 은 로컬 저장소에서만 됩니다. Firestore 데모 데이터는 콘솔의 Firestore 화면에서 지우세요.

## 3. 확인

1. 폰에서 `https://<서비스 주소>/?t=<토큰>` → 테스트 5개 → 저장
2. 보증서 만들기 → AI 판별 → 발급 → 보증서 링크
3. `https://<서비스 주소>/buyer` 에서 검색

로그: `gcloud run services logs read green-circuit --region asia-northeast3 --limit 50` (`✔ 저장됨`, `✔ AI 판별`, `✔ 보증서 발급` 줄)

## 알아 둘 것

- 토큰 하나를 판매자 모두가 같이 씁니다. 데모용이며, 실제 서비스는 로그인(Firebase Auth)이 필요합니다.
- 900KB 넘는 테스트 사진은 Firestore 에 저장하지 않습니다(보증서에 테스트 사진만 빠짐). 폰 사진은 보통 600KB 안팎.
