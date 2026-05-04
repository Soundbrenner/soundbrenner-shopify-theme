#!/usr/bin/env bash

# Source this file to load local Shopify credentials from macOS Keychain:
#
#   source scripts/shopify-keychain-env.sh
#
# Or run one command with the credentials loaded:
#
#   scripts/shopify-keychain-env.sh npm run qa:snap
#
# Secrets stay in Keychain and are not written to the repo.

set -euo pipefail

read_keychain_value() {
  local service="$1"
  /usr/bin/security find-generic-password -a "$USER" -s "$service" -w 2>/dev/null || true
}

export SHOPIFY_STORE_DOMAIN="${SHOPIFY_STORE_DOMAIN:-$(read_keychain_value codex-shopify-store-domain)}"
export SHOPIFY_SHOP="${SHOPIFY_SHOP:-$SHOPIFY_STORE_DOMAIN}"
export SHOPIFY_CLIENT_ID="${SHOPIFY_CLIENT_ID:-$(read_keychain_value codex-shopify-client-id)}"
export SHOPIFY_CLIENT_SECRET="${SHOPIFY_CLIENT_SECRET:-$(read_keychain_value codex-shopify-client-secret)}"
export SHOPIFY_API_VERSION="${SHOPIFY_API_VERSION:-$(read_keychain_value codex-shopify-api-version)}"

# This Keychain item exists for compatibility with older scripts. It may be
# invalid; prefer Shopify CLI auth or OAuth/client credentials for new tooling.
export SHOPIFY_ADMIN_ACCESS_TOKEN="${SHOPIFY_ADMIN_ACCESS_TOKEN:-$(read_keychain_value codex-shopify-admin-access-token)}"
export SHOPIFY_ADMIN_TOKEN="${SHOPIFY_ADMIN_TOKEN:-$SHOPIFY_ADMIN_ACCESS_TOKEN}"

missing=()
[[ -n "$SHOPIFY_STORE_DOMAIN" ]] || missing+=("codex-shopify-store-domain")
[[ -n "$SHOPIFY_CLIENT_ID" ]] || missing+=("codex-shopify-client-id")
[[ -n "$SHOPIFY_CLIENT_SECRET" ]] || missing+=("codex-shopify-client-secret")
[[ -n "$SHOPIFY_API_VERSION" ]] || missing+=("codex-shopify-api-version")

if (( ${#missing[@]} )); then
  printf 'Missing Shopify Keychain item(s): %s\n' "${missing[*]}" >&2
  return 1 2>/dev/null || exit 1
fi

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if (( $# == 0 )); then
    echo "Loaded Shopify Keychain env for $SHOPIFY_STORE_DOMAIN."
    echo "Run as: source scripts/shopify-keychain-env.sh"
    echo "Or: scripts/shopify-keychain-env.sh <command>"
    exit 0
  fi

  exec "$@"
fi
