#!/usr/bin/env bash
# 建立 Strava webhook 訂閱（一次性）。一個 Strava API 應用程式只能有一個訂閱。
#
# 用法：
#   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_VERIFY_TOKEN=... \
#   CALLBACK_URL=https://running-bot.<account>.workers.dev \
#   ./scripts/create-subscription.sh
#
# 子指令：
#   ./scripts/create-subscription.sh list     # 查看現有訂閱
#   ./scripts/create-subscription.sh delete <id>
set -euo pipefail

: "${STRAVA_CLIENT_ID:?need STRAVA_CLIENT_ID}"
: "${STRAVA_CLIENT_SECRET:?need STRAVA_CLIENT_SECRET}"
API=https://www.strava.com/api/v3/push_subscriptions

case "${1:-create}" in
  list)
    curl -sS -G "$API" \
      -d client_id="$STRAVA_CLIENT_ID" \
      -d client_secret="$STRAVA_CLIENT_SECRET"
    echo
    ;;
  delete)
    : "${2:?usage: $0 delete <subscription_id>}"
    curl -sS -X DELETE "$API/$2" \
      -d client_id="$STRAVA_CLIENT_ID" \
      -d client_secret="$STRAVA_CLIENT_SECRET"
    echo
    ;;
  create)
    : "${STRAVA_VERIFY_TOKEN:?need STRAVA_VERIFY_TOKEN}"
    : "${CALLBACK_URL:?need CALLBACK_URL (your Worker URL)}"
    echo "Creating subscription → $CALLBACK_URL"
    curl -sS -X POST "$API" \
      -F client_id="$STRAVA_CLIENT_ID" \
      -F client_secret="$STRAVA_CLIENT_SECRET" \
      -F callback_url="$CALLBACK_URL" \
      -F verify_token="$STRAVA_VERIFY_TOKEN"
    echo
    echo "把回傳的 id 填入 wrangler.toml 的 STRAVA_SUBSCRIPTION_ID，再部署一次。"
    ;;
  *)
    echo "unknown command: $1" >&2; exit 1 ;;
esac
