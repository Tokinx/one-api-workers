#!/bin/bash
# E2E tests against mock upstream
# Prerequisites: mock-upstream running on :9999, wrangler dev on :8788

API="${API:-http://localhost:8787}"
MOCK_API="${MOCK_API:-http://localhost:9999}"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.local.jsonc}"
DB_NAME="${DB_NAME:-one-api}"
DB_EXEC=(npx wrangler d1 execute "$DB_NAME" --local --config "$WRANGLER_CONFIG" --command)
PASS=0
FAIL=0
TOTAL=0

assert() {
  local name="$1" expected="$2" actual="$3"
  TOTAL=$((TOTAL + 1))
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✅ #$TOTAL $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ #$TOTAL $name"
    echo "     expected: $expected"
    echo "     actual:   $(echo "$actual" | head -1)"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local name="$1" unexpected="$2" actual="$3"
  TOTAL=$((TOTAL + 1))
  if echo "$actual" | grep -q "$unexpected"; then
    echo "  ❌ #$TOTAL $name"
    echo "     unexpected: $unexpected"
    echo "     actual:     $(echo "$actual" | head -1)"
    FAIL=$((FAIL + 1))
  else
    echo "  ✅ #$TOTAL $name"
    PASS=$((PASS + 1))
  fi
}

assert_http() {
  local name="$1" expected_code="$2" expected_body="$3" actual="$4"
  local code=$(echo "$actual" | tail -1)
  local body=$(echo "$actual" | sed '$d')
  TOTAL=$((TOTAL + 1))
  if [[ "$code" == "$expected_code" ]] && echo "$body" | grep -q "$expected_body"; then
    echo "  ✅ #$TOTAL $name [HTTP $code]"
    PASS=$((PASS + 1))
  else
    echo "  ❌ #$TOTAL $name [HTTP $code]"
    echo "     expected: HTTP $expected_code + '$expected_body'"
    echo "     actual:   $(echo "$body" | head -1)"
    FAIL=$((FAIL + 1))
  fi
}

do_get() { curl -s -w "\n%{http_code}" "$@"; }
do_post() { curl -s -w "\n%{http_code}" -X POST "$@"; }
reset_mock_inspection() { curl -s -X POST "$MOCK_API/__reset" > /dev/null; }
get_mock_inspection() { curl -sG "$MOCK_API/__inspect" --data-urlencode "key=$1"; }

if [[ -f ".dev.vars" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".dev.vars"
  set +a
fi

echo ""
echo "========================================="
echo "  E2E Tests with Mock Upstream"
echo "========================================="

# ---- /v1/models ----
echo ""
echo "--- GET /v1/models ---"

R=$(do_get "$API/v1/models")
assert_http "no key → empty list" "200" '"data":\[\]' "$R"

R=$(do_get -H "Authorization: Bearer bad" "$API/v1/models")
assert_http "invalid key → 401" "401" "Invalid API key" "$R"

R=$(do_get -H "Authorization: Bearer sk-mock-all" "$API/v1/models")
assert_http "full token → has gpt-4o" "200" "gpt-4o" "$R"

R=$(do_get -H "x-api-key: sk-mock-openai" "$API/v1/models")
assert_http "limited token → has gpt-4 only" "200" "gpt-4" "$R"

# ---- /v1/chat/completions errors ----
echo ""
echo "--- POST /v1/chat/completions (errors) ---"

R=$(do_post "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}')
assert_http "no auth → 401" "401" "Authorization header" "$R"

R=$(do_post -H "Authorization: Bearer bad" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}')
assert_http "invalid key → 401" "401" "Invalid API key" "$R"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/chat/completions" -H "Content-Type: application/json" -d 'not-json')
assert_http "invalid JSON → 400" "400" "Invalid JSON body" "$R"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"messages":[]}')
assert_http "no model → 400" "400" "Model is required" "$R"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"nonexistent","messages":[]}')
assert_http "unmapped model → 400" "400" "Model not supported" "$R"

R=$(do_post -H "Authorization: Bearer sk-mock-openai" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"claude-3-opus","messages":[]}')
assert_http "limited token, wrong model → 400" "400" "Model not supported" "$R"

# ---- /v1/chat/completions via openai provider (non-stream) ----
echo ""
echo "--- POST /v1/chat/completions (openai, non-stream) ---"

R=$(do_post -H "Authorization: Bearer sk-mock-openai" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}')
assert_http "openai non-stream → 200 + usage" "200" "Mock response" "$R"

# ---- /v1/chat/completions via openai provider (stream) ----
echo ""
echo "--- POST /v1/chat/completions (openai, stream) ---"

R=$(do_post -H "Authorization: Bearer sk-mock-openai" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"hi"}]}')
assert_http "openai stream → 200 + SSE" "200" "data:" "$R"

reset_mock_inspection
R=$(do_post \
  -H "Authorization: Bearer sk-mock-openai" \
  -H "x-api-key: leaked-client-key" \
  -H "Cookie: session=leak-me" \
  -H "X-Forwarded-For: 203.0.113.10" \
  "$API/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"header check"}]}')
assert_http "openai header whitelist → 200" "200" "Mock response" "$R"
INSPECT=$(get_mock_inspection "chat-completions")
assert "openai upstream auth replaced with channel key" "\"authorization\":\"Bearer mock-key\"" "$INSPECT"
assert_not_contains "openai upstream strips client x-api-key" "leaked-client-key" "$INSPECT"
assert_not_contains "openai upstream strips cookie" "\"cookie\":" "$INSPECT"
assert_not_contains "openai upstream strips x-forwarded-for" "\"x-forwarded-for\":" "$INSPECT"

# ---- /v1/chat/completions via azure-openai (non-stream) ----
echo ""
echo "--- POST /v1/chat/completions (azure-openai, non-stream) ---"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"gpt-4o-azure","messages":[{"role":"user","content":"hi"}]}')
assert_http "azure non-stream → 200" "200" "Mock response" "$R"

# ---- /v1/chat/completions via azure-openai (stream) ----
echo ""
echo "--- POST /v1/chat/completions (azure-openai, stream) ---"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"gpt-4o-azure","stream":true,"messages":[{"role":"user","content":"hi"}]}')
assert_http "azure stream → 200 + SSE" "200" "data:" "$R"

# ---- /v1/messages via claude (non-stream) ----
echo ""
echo "--- POST /v1/messages (claude, non-stream) ---"

R=$(do_post -H "x-api-key: sk-mock-all" "$API/v1/messages" -H "Content-Type: application/json" -d '{"model":"claude-3-opus","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}')
assert_http "claude non-stream → 200" "200" "Mock Claude response" "$R"

# ---- /v1/messages via claude (stream) ----
echo ""
echo "--- POST /v1/messages (claude, stream) ---"

R=$(do_post -H "x-api-key: sk-mock-all" "$API/v1/messages" -H "Content-Type: application/json" -d '{"model":"claude-3-opus","stream":true,"max_tokens":100,"messages":[{"role":"user","content":"hi"}]}')
assert_http "claude stream → 200 + SSE" "200" "event:" "$R"

reset_mock_inspection
R=$(do_post \
  -H "x-api-key: sk-mock-all" \
  -H "Cookie: session=leak-me" \
  -H "X-Forwarded-For: 203.0.113.11" \
  "$API/v1/messages" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-opus","max_tokens":100,"messages":[{"role":"user","content":"header check"}]}')
assert_http "claude header whitelist → 200" "200" "Mock Claude response" "$R"
INSPECT=$(get_mock_inspection "messages")
assert "claude upstream x-api-key replaced with channel key" "\"x-api-key\":\"mock-key\"" "$INSPECT"
assert_not_contains "claude upstream strips client token value" "sk-mock-all" "$INSPECT"
assert_not_contains "claude upstream strips cookie" "\"cookie\":" "$INSPECT"
assert_not_contains "claude upstream strips x-forwarded-for" "\"x-forwarded-for\":" "$INSPECT"

# ---- /v1/messages via claude-to-openai (non-stream) ----
echo ""
echo "--- POST /v1/messages (claude-to-openai, non-stream) ---"

R=$(do_post -H "x-api-key: sk-mock-all" "$API/v1/messages" -H "Content-Type: application/json" -d '{"model":"claude-via-openai","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}')
assert_http "c2o non-stream → 200" "200" "message" "$R"

# ---- /v1/responses errors ----
echo ""
echo "--- POST /v1/responses (errors) ---"

R=$(do_post "$API/v1/responses" -H "Content-Type: application/json" -d '{"model":"gpt-4o-resp","input":"hi"}')
assert_http "no auth → 401" "401" "Authorization header" "$R"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/responses" -H "Content-Type: application/json" -d '{"model":"gpt-4o","input":"hi"}')
assert_http "non-responses model → 400" "400" "Model not supported" "$R"

# ---- /v1/responses via openai-responses (non-stream) ----
echo ""
echo "--- POST /v1/responses (openai-responses, non-stream) ---"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/responses" -H "Content-Type: application/json" -d '{"model":"gpt-4o-resp","input":"hi"}')
assert_http "responses non-stream → 200 + usage" "200" "Mock responses output" "$R"

# ---- /v1/responses via openai-responses (stream) ----
echo ""
echo "--- POST /v1/responses (openai-responses, stream) ---"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/responses" -H "Content-Type: application/json" -d '{"model":"gpt-4o-resp","stream":true,"input":"hi"}')
assert_http "responses stream → 200 + SSE" "200" "event:" "$R"

# ---- /v1/responses via azure-openai-responses (non-stream) ----
echo ""
echo "--- POST /v1/responses (azure-openai-responses, non-stream) ---"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/responses" -H "Content-Type: application/json" -d '{"model":"gpt-4o-azure-resp","input":"hi"}')
assert_http "azure responses non-stream → 200" "200" "Mock responses output" "$R"

# ---- /v1/responses via azure-openai-responses (stream) ----
echo ""
echo "--- POST /v1/responses (azure-openai-responses, stream) ---"

R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/responses" -H "Content-Type: application/json" -d '{"model":"gpt-4o-azure-resp","stream":true,"input":"hi"}')
assert_http "azure responses stream → 200 + SSE" "200" "event:" "$R"

# ---- Quota ----
echo ""
echo "--- Quota check ---"

"${DB_EXEC[@]}" "UPDATE api_token SET usage = 99999999 WHERE key = 'sk-mock-all'" > /dev/null 2>&1
R=$(do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"gpt-4o","messages":[]}')
assert_http "quota exceeded → 402" "402" "Quota exceeded" "$R"
"${DB_EXEC[@]}" "UPDATE api_token SET usage = 0 WHERE key = 'sk-mock-all'" > /dev/null 2>&1

# ---- Admin cookie session ----
echo ""
echo "--- Admin session cookie ---"

"${DB_EXEC[@]}" "INSERT OR REPLACE INTO settings (key, value) VALUES ('SYSTEM_CONFIG', '{\"displayDecimals\":6,\"adminSecurity\":{\"enabled\":false,\"telegramBotToken\":\"\",\"telegramChatId\":\"\",\"verifiedFingerprint\":\"\",\"verifiedAt\":null},\"apiDocs\":{\"enabled\":true}}')" > /dev/null 2>&1
COOKIE_JAR=$(mktemp)
LOGIN_PAYLOAD=$(printf '{"token":"%s"}' "$ADMIN_TOKEN")

R=$(do_post "$API/api/admin/auth/login" -H "Content-Type: application/json" -c "$COOKIE_JAR" -d "$LOGIN_PAYLOAD")
assert_http "admin login → 200" "200" "\"requiresVerification\":false" "$R"
assert "admin login response keeps session token out of body" "\"sessionToken\":null" "$R"
assert "admin login sets session cookie" "oaw_admin_session" "$(cat "$COOKIE_JAR")"

R=$(do_get -b "$COOKIE_JAR" "$API/api/admin/channel")
assert_http "admin cookie grants access" "200" "\"success\":true" "$R"

R=$(do_post -b "$COOKIE_JAR" -c "$COOKIE_JAR" "$API/api/admin/auth/logout")
assert_http "admin logout → 200" "200" "\"success\":true" "$R"

R=$(do_get -b "$COOKIE_JAR" "$API/api/admin/channel")
assert_http "admin cookie invalid after logout" "401" "Unauthorized" "$R"

rm -f "$COOKIE_JAR"

# ---- Error recovery ----
echo ""
echo "--- Error recovery ---"

do_post -H "Authorization: Bearer sk-mock-all" "$API/v1/chat/completions" -H "Content-Type: application/json" -d 'bad' > /dev/null 2>&1
R=$(do_post -H "Authorization: Bearer sk-mock-openai" "$API/v1/chat/completions" -H "Content-Type: application/json" -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}')
assert_http "recover after error → 200" "200" "Mock response" "$R"

# ---- Summary ----
echo ""
echo "========================================="
echo "  Results: $PASS/$TOTAL PASS, $FAIL FAIL"
echo "========================================="

# Cleanup test data
echo ""
echo "Cleaning up test data..."
for key in test-openai test-azure test-claude test-c2o test-responses test-azure-resp; do
  "${DB_EXEC[@]}" "DELETE FROM channel_config WHERE key = '$key'" > /dev/null 2>&1
done
for key in sk-mock-all sk-mock-openai sk-mock-quota; do
  "${DB_EXEC[@]}" "DELETE FROM api_token WHERE key = '$key'" > /dev/null 2>&1
done
echo "Cleanup done."

exit $FAIL
