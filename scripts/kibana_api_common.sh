#!/usr/bin/env bash
# Shared Kibana API utilities.
# Source this file from any skill or script to get auto-detected KIBANA_URL,
# KIBANA_AUTH, and a kibana_curl wrapper.
#
# Usage:
#   REPO_ROOT="$(git rev-parse --show-toplevel)"
#   source "$REPO_ROOT/scripts/kibana_api_common.sh"
#
# After sourcing, KIBANA_URL and KIBANA_AUTH are set to working values.
# If auto-detection fails and no overrides were provided, the script exits with an error.
#
# Detection is done by `node scripts/local_stack.js env` (@kbn/local-stack-connection), the same
# logic Node scripts use: local stateful (elastic) and serverless (elastic_serverless) stacks over
# http and https, the dev base path, and KIBANA_URL / KIBANA_AUTH / KIBANA_USERNAME /
# KIBANA_PASSWORD overrides.

# Allow callers to override before sourcing
KIBANA_URL="${KIBANA_URL:-}"
KIBANA_AUTH="${KIBANA_AUTH:-}"

# Set KIBANA_USE_SESSION=true to authenticate via the 'basic' auth provider
# (session cookie) instead of the default HTTP Basic auth (__http__ provider).
#
# Why this matters: the browser uses the 'basic' auth provider, while HTTP
# Basic auth uses the '__http__' provider. These are separate auth realms.
# Any per-user state tied to a browser session (OAuth tokens, user-specific
# settings, etc.) is invisible to API calls made via HTTP Basic auth.
# Session cookie auth uses the same 'basic' provider as the browser.
KIBANA_USE_SESSION="${KIBANA_USE_SESSION:-false}"
_SESSION_COOKIE_JAR=""
_KIBANA_TLS_FLAGS=()
_KIBANA_API_KEY=""

_KIBANA_API_COMMON_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

detect_kibana() {
  local env_output
  if ! env_output="$(KIBANA_URL="$KIBANA_URL" KIBANA_AUTH="$KIBANA_AUTH" \
    node "$_KIBANA_API_COMMON_REPO_ROOT/scripts/local_stack.js" env --skip-elasticsearch)"; then
    echo "$env_output" >&2
    echo "" >&2
    echo "Please ensure Kibana is running, or set KIBANA_URL and KIBANA_AUTH explicitly." >&2
    return 1
  fi

  local KIBANA_USERNAME="" KIBANA_PASSWORD="" KIBANA_API_KEY="" LOCAL_STACK_CA_CERT="" LOCAL_STACK_INSECURE=""
  eval "$env_output"
  if [[ -n "$KIBANA_API_KEY" ]]; then
    _KIBANA_API_KEY="$KIBANA_API_KEY"
  else
    KIBANA_AUTH="$KIBANA_USERNAME:$KIBANA_PASSWORD"
  fi

  if [[ -n "$LOCAL_STACK_INSECURE" ]]; then
    _KIBANA_TLS_FLAGS=(-k)
  elif [[ -n "$LOCAL_STACK_CA_CERT" ]]; then
    _KIBANA_TLS_FLAGS=(--cacert "$LOCAL_STACK_CA_CERT")
  fi
}

# Logs in via the 'basic' auth provider to obtain a session cookie.
# This puts API calls in the same auth realm as the browser.
_acquire_session() {
  local username="${KIBANA_AUTH%%:*}"
  local password="${KIBANA_AUTH#*:}"
  _SESSION_COOKIE_JAR="$(mktemp -t kibana_session.XXXXXX)"

  local payload
  if command -v jq &>/dev/null; then
    payload="$(jq -n \
      --arg u "$username" \
      --arg p "$password" \
      --arg url "$KIBANA_URL/" \
      '{providerType:"basic",providerName:"basic",currentURL:$url,params:{username:$u,password:$p}}')"
  else
    payload="{\"providerType\":\"basic\",\"providerName\":\"basic\",\"currentURL\":\"${KIBANA_URL}/\",\"params\":{\"username\":\"${username}\",\"password\":\"${password}\"}}"
  fi

  local http_code
  http_code="$(curl -s ${_KIBANA_TLS_FLAGS[@]+"${_KIBANA_TLS_FLAGS[@]}"} -o /dev/null -w "%{http_code}" \
    -c "$_SESSION_COOKIE_JAR" \
    -H "kbn-xsrf: true" \
    -H "x-elastic-internal-origin: Kibana" \
    -H "Content-Type: application/json" \
    -X POST "$KIBANA_URL/internal/security/login" \
    -d "$payload" 2>/dev/null)"

  if [[ "$http_code" != "200" ]]; then
    echo "Warning: Session login failed (HTTP $http_code). Falling back to HTTP Basic auth." >&2
    rm -f "$_SESSION_COOKIE_JAR"
    _SESSION_COOKIE_JAR=""
    KIBANA_USE_SESSION="false"
  else
    echo "Session acquired via 'basic' auth provider (cookie auth)" >&2
  fi
}

# Wrapper around curl with Kibana auth, required headers, and TLS handling.
kibana_curl() {
  local auth_flags=()
  if [[ -n "$_SESSION_COOKIE_JAR" ]]; then
    auth_flags+=(-b "$_SESSION_COOKIE_JAR")
  elif [[ -n "$_KIBANA_API_KEY" ]]; then
    auth_flags+=(-H "Authorization: ApiKey $_KIBANA_API_KEY")
  else
    auth_flags+=(-u "$KIBANA_AUTH")
  fi

  curl -s ${_KIBANA_TLS_FLAGS[@]+"${_KIBANA_TLS_FLAGS[@]}"} \
    "${auth_flags[@]}" \
    -H "kbn-xsrf: true" \
    -H "x-elastic-internal-origin: Kibana" \
    "$@"
}

# Run detection on source
detect_kibana || { return 1 2>/dev/null || exit 1; }

# Acquire session cookie if requested
if [[ "$KIBANA_USE_SESSION" == "true" ]]; then
  _acquire_session
fi
