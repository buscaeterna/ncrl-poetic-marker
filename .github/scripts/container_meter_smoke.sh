#!/usr/bin/env bash
set -euo pipefail
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
[[ $(curl --fail -s "$api/jobs/$jid" | jq -r .status) == succeeded ]]
[[ $(curl --fail -s "$api/projects/$pid" | jq -r .revision) -eq $revision ]]
docker compose stop worker
cancel=$(curl --fail -s -X POST "$api/projects/$pid/meter/jobs" -H 'content-type: application/json' -d "{\"poem_ids\":[\"p\"],\"revision\":$revision,\"analyzer_version\":\"meter-1.0.0\"}")
cid=$(jq -r .id <<<"$cancel"); curl --fail -s -X POST "$api/jobs/$cid/cancel" >/dev/null
[[ $(curl --fail -s "$api/jobs/$cid" | jq -r .status) == cancelled ]]
docker compose start worker
[[ $(curl --fail -s "$api/projects/$pid" | jq -r .revision) -eq $revision ]]
echo "meter API/worker/PostgreSQL restart and cancellation smoke passed"
