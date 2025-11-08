#!/bin/bash
# test_tweet.sh

if [ -f .env ]; then
  set -o allexport
  source .env
  set +o allexport
else
  echo "Cannot find .env file."
  exit 1
fi

if [ -z "$CRON_SECRET" ]; then
  echo "Cannot read CRON_SECRET from .env file."
  exit 1
fi

ENCODED_SECRET=$(node -e "console.log(encodeURIComponent('$CRON_SECRET'))")

curl --fail "http://localhost:3000/api/daily?secret=$ENCODED_SECRET"
echo ""