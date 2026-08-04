set -euo pipefail
diagnostics() {
  docker compose ps || true
  docker compose logs --no-color --tail=200 api worker gateway db || true
}
trap diagnostics ERR
wait_gateway_ready() {
  local attempts=${1:-45}
  for ((i=1;i<=attempts;i++)); do
    if curl -fsS "$base/ready" >/dev/null; then return 0; fi
    sleep 2
  done
  echo "gateway did not recover /api/v1/ready after $((attempts*2)) seconds" >&2
  return 1
}
base=http://localhost:8080/api/v1
python .github/scripts/make_digital_pdf.py
project=$(curl -fsS -X POST "$base/projects" -H 'content-type: application/json' -d '{"name":"PDF smoke","workspace":{"corpora":[],"poems":[],"activeId":null,"queue":[]}}'); id=$(jq -r .id<<<"$project")
source=$(curl -fsS -X POST "$base/projects/$id/sources" -F file=@/tmp/digital.pdf -F upload_order=0); source_id=$(jq -r .id<<<"$source")
started=$(curl -fsS -X POST "$base/sources/$source_id/extract"); job_id=$(jq -r .job_id<<<"$started")
for i in {1..60};do job=$(curl -fsS "$base/jobs/$job_id");status=$(jq -r .status<<<"$job");[ "$status" = succeeded ]&&break;[ "$status" = failed ]&&{ echo "$job";exit 1;};sleep 1;done
test "$status" = succeeded; test "$(jq -r .progress<<<"$job")" = 1.0
source=$(curl -fsS "$base/sources/$source_id"); test "$(jq '.pages|length'<<<"$source")" = 1; curl -fsS "$base/sources/$source_id/preview/1" -o /tmp/preview.png; test -s /tmp/preview.png
revision=$(jq -r '.pages[0].revision'<<<"$source"); curl -fsS -X PATCH "$base/sources/$source_id/pages/1" -H 'content-type: application/json' -d "{\"revision\":$revision,\"edited_text\":\"First poem\\nSecond line\",\"review_status\":\"approved\"}" >/dev/null
curl -fsS -X POST "$base/sources/$source_id/approve" >/dev/null
latest=$(curl -fsS "$base/projects/$id"); revision=$(jq -r .revision<<<"$latest"); workspace='{"corpora":[],"poems":[{"id":"p","corpusId":"c","sourceName":"poem.htm","sourceOrder":0,"author":"","title":"First poem","date":"","cycle":"","fields":{},"structures":[],"originalHtml":"","lines":[],"status":"review","dirty":false,"modified":false,"provenance":{"sourceDocumentId":"'$source_id'","sourcePdfName":"digital.pdf","pageRange":"1","usedOcr":false,"confirmedAt":"2026-01-01T00:00:00Z"}}],"activeId":"p","queue":["p"]}'
curl -fsS -X PUT "$base/projects/$id" -H 'content-type: application/json' -d "{\"name\":\"PDF smoke\",\"schema_version\":1,\"revision\":$revision,\"workspace\":$workspace}" >/dev/null
docker compose restart api worker
# nginx resolves an upstream name when it starts and otherwise retains the old
# container IP. Wait for the replacement API, then restart gateway so Docker DNS
# is resolved again, and finally assert readiness through the public route.
for i in {1..45}; do
  api_id=$(docker compose ps -q api)
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_id")
  [ "$health" = healthy ] && break
  sleep 2
done
test "${health:-}" = healthy
docker compose restart gateway
wait_gateway_ready 45
curl -fsS "$base/sources/$source_id" | jq -e '.pages[0].edited_text=="First poem\nSecond line"' >/dev/null
curl -fsS "$base/projects/$id" | jq -e '.workspace.poems[0].provenance.sourceDocumentId=="'$source_id'"' >/dev/null
# Real rus+eng OCR smoke with an image-only PDF and multiple verse lines.
api_container=$(docker compose ps -q api)
docker compose exec -T api python - <<'PY'
from PIL import Image,ImageDraw,ImageFont
image=Image.new('RGB',(1400,700),'white');draw=ImageDraw.Draw(image);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',64)
draw.multiline_text((70,70),'Мороз и солнце день чудесный\nЕще ты дремлешь друг прелестный\n\nПора красавица проснись',font=font,fill='black',spacing=28)
image.save('/tmp/russian-scan.pdf','PDF',resolution=150)
PY
docker cp "$api_container:/tmp/russian-scan.pdf" /tmp/russian-scan.pdf
scan=$(curl -fsS -X POST "$base/projects/$id/sources" -F file=@/tmp/russian-scan.pdf -F upload_order=1); scan_id=$(jq -r .id<<<"$scan")
scan_start=$(curl -fsS -X POST "$base/sources/$scan_id/extract"); scan_job=$(jq -r .job_id<<<"$scan_start")
for i in {1..120};do state=$(curl -fsS "$base/jobs/$scan_job");status=$(jq -r .status<<<"$state");[ "$status" = succeeded ]&&break;[ "$status" = failed ]&&{ echo "$state";exit 1;};sleep 1;done
test "$status" = succeeded
ocr=$(curl -fsS "$base/sources/$scan_id" | jq -r '.pages[0].edited_text'); grep -qi 'мороз.*солнце'<<<"$ocr"; test "$(wc -l<<<"$ocr")" -ge 2
