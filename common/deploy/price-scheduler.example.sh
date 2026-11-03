#!/bin/sh
# 실행하지 않은 준비용 명령. 프로젝트·리전·스케줄 호출용 서비스 계정을 설정한 뒤 운영자가 실행.
set -eu
: "${PROJECT_ID:?required}" "${REGION:?required}" "${SCHEDULER_SERVICE_ACCOUNT:?required}"
gcloud scheduler jobs create http green-circuit-price-daily \
  --project "$PROJECT_ID" --location "$REGION" \
  --schedule '0 9 * * *' --time-zone 'Asia/Seoul' \
  --uri "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/green-circuit-price-daily:run" \
  --http-method POST --message-body '{}' \
  --oauth-service-account-email "$SCHEDULER_SERVICE_ACCOUNT"
