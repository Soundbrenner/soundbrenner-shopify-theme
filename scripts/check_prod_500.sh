#!/usr/bin/env bash

set -euo pipefail

URL="${1:-https://www.soundbrenner.com/products/wave-in-ear-monitors}"
ATTEMPTS="${2:-500}"
SLEEP_SECONDS="${3:-1}"
OUT_DIR="${4:-/tmp/soundbrenner-prod-check}"

mkdir -p "$OUT_DIR"

echo "Checking: $URL"
echo "Attempts: $ATTEMPTS"
echo "Sleep: ${SLEEP_SECONDS}s"
echo "Logs: $OUT_DIR"

for ((i=1; i<=ATTEMPTS; i++)); do
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  body_file="$OUT_DIR/body-$i.html"
  headers_file="$OUT_DIR/headers-$i.txt"

  http_code="$(
    curl -sS \
      -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15" \
      -D "$headers_file" \
      -o "$body_file" \
      -L \
      -w "%{http_code}" \
      "$URL"
  )"

  if grep -qiE 'body class="status-error status-code-500"|There was a problem loading this website|Try refreshing the page\.' "$body_file" || [[ "$http_code" =~ ^5 ]]; then
    echo "FAILURE on attempt $i at $ts"
    echo "HTTP: $http_code"
    echo "Body: $body_file"
    echo "Headers: $headers_file"
    exit 1
  fi

  rm -f "$body_file" "$headers_file"
  echo "ok $i $ts HTTP:$http_code"
  sleep "$SLEEP_SECONDS"
done

echo "Completed $ATTEMPTS attempts without reproducing a storefront 5xx page."
