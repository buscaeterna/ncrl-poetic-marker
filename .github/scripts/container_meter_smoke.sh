#!/usr/bin/env bash
set -euo pipefail
diagnostics() {
  local code=$?
  trap - ERR
  set +e
  echo "meter smoke failed; container state and recent logs follow" >&2
  docker compose ps >&2
  docker compose logs --no-color --tail=200 api worker gateway db >&2
  exit "$code"
}
trap diagnostics ERR
wait_api_healthy() {
  local attempts=${1:-45} api_id health=""
  for ((i=1;i<=attempts;i++)); do
    api_id=$(docker compose ps -q api)
    if [[ -n "$api_id" ]]; then
      health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_id")
      [[ "$health" == healthy ]] && return 0
    fi
    sleep 2
  done
  echo "replacement API did not become healthy after $((attempts*2)) seconds (last state: ${health:-missing})" >&2
  return 1
}
wait_gateway_ready() {
  local attempts=${1:-45}
  for ((i=1;i<=attempts;i++)); do
    if curl -fsS "$api/ready" >/dev/null; then return 0; fi
    sleep 2
  done
  echo "gateway did not recover /api/v1/ready after $((attempts*2)) seconds" >&2
  return 1
}
api=http://localhost:8080/api/v1
workspace='{"corpora":[],"poems":[{"id":"p","title":"Smoke","lines":[{"id":"l","text":"а` а`","meter":"","feet":0,"clause":"м","scheme":"","starred":false,"breakBefore":false,"note":""}]}],"activeId":"p","queue":["p"]}'
project=$(curl --fail -s -X POST "$api/projects" -H 'content-type: application/json' -d "{\"name\":\"Meter smoke\",\"workspace\":$workspace}")
pid=$(jq -r .id <<<"$project")
job=$(curl --fail -s -X POST "$api/projects/$pid/meter/jobs" -H 'content-type: application/json' -d '{"poem_ids":["p"],"revision":1,"analyzer_version":"meter-1.0.0"}')
jid=$(jq -r .id <<<"$job")
for _ in $(seq 1 60); do job=$(curl --fail -s "$api/jobs/$jid"); status=$(jq -r .status <<<"$job"); [[ $status == succeeded ]] && break; [[ $status == failed ]] && { echo "$job"; exit 1; }; sleep 1; done
[[ $status == succeeded ]]
saved=$(curl --fail -s "$api/projects/$pid"); [[ $(jq -r '.workspace.poems[0].lines[0].meterSuggestion.selected.meter' <<<"$saved") == Тк ]]
revision=$(jq -r .revision <<<"$saved"); [[ $revision -eq 2 ]]
docker compose restart api worker; docker compose up -d --wait api worker
wait_api_healthy 45
# nginx retains the old upstream IP after Compose replaces/restarts API. Restart
# it only after the new API is healthy, then verify the public route with retries.
docker compose restart gateway
wait_gateway_ready 45
[[ $(curl --fail -s "$api/jobs/$jid" | jq -r .status) == succeeded ]]
[[ $(curl --fail -s "$api/projects/$pid" | jq -r .revision) -eq $revision ]]
docker compose stop worker
cancel=$(curl --fail -s -X POST "$api/projects/$pid/meter/jobs" -H 'content-type: application/json' -d "{\"poem_ids\":[\"p\"],\"revision\":$revision,\"analyzer_version\":\"meter-1.0.0\"}")
cid=$(jq -r .id <<<"$cancel"); curl --fail -s -X POST "$api/jobs/$cid/cancel" >/dev/null
[[ $(curl --fail -s "$api/jobs/$cid" | jq -r .status) == cancelled ]]
docker compose start worker
[[ $(curl --fail -s "$api/projects/$pid" | jq -r .revision) -eq $revision ]]
echo "meter API/worker/PostgreSQL restart and cancellation smoke passed"
