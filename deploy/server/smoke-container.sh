#!/usr/bin/env bash
# CI only: uses fake credentials and never requests Shopify data.
set -euo pipefail
image=${1:-channel-desk:ci}
tmp=$(mktemp -d)
container="channel-desk-ci-$RANDOM"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
cat > "$tmp/runtime.config.json" <<'JSON'
{"CHANNEL_DESK_PUBLIC_ORIGIN":"https://ci.example.com","SHOPIFY_CLIENT_ID":"ci-only","SHOPIFY_CLIENT_SECRET":"ci-only"}
JSON
# The image's non-root UID must be able to read the host-mounted test file.
chmod 644 "$tmp/runtime.config.json"
docker run -d --name "$container" --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true -p 127.0.0.1::5188 --mount "type=bind,source=$tmp/runtime.config.json,target=/run/channel-desk/runtime.config.json,readonly" -e CHANNEL_DESK_CONFIG_FILE=/run/channel-desk/runtime.config.json "$image" >/dev/null
port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5188/tcp") 0).HostPort}}' "$container")
for attempt in {1..40}; do
  if curl --silent --fail "http://127.0.0.1:$port/api/health" > "$tmp/health.json"; then break; fi
  if [ "$attempt" = 40 ]; then docker logs "$container"; exit 1; fi
  sleep 1
done
curl --silent --fail -H 'Host: ci.example.com' -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$port/api/auth/session" > "$tmp/session.json"
python3 - "$tmp/session.json" <<'PY'
import json,sys
session=json.load(open(sys.argv[1]));assert session['authMode']=='shopify' and session['authenticated'] is False
PY
status=$(curl --silent -o /dev/null -w '%{http_code}' -H 'Host: ci.example.com' -H 'X-Forwarded-Proto: https' -H 'Origin: https://ci.example.com' -H 'Content-Type: application/json' --data '{}' "http://127.0.0.1:$port/api/dashboard")
[ "$status" = 401 ]
status=$(curl --silent -o /dev/null -w '%{http_code}' -H 'Host: ci.example.com' -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$port/setup")
[ "$status" = 403 ]
printf 'Container start, mounted config and authentication boundary checks passed.\n'
