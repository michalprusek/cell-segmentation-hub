#!/usr/bin/env bash
# Maintenance page for the three public sites of this server (spherosegapp, maptimize, curator).
#
#   scripts/maintenance.sh on               every request to the three sites gets the static page with HTTP 503
#   scripts/maintenance.sh on --stop-node   the same, then stop the Node containers (so the admin can be told Node is off)
#   scripts/maintenance.sh off              start the Node containers if stopped, wait until healthy, then remove the page
#   scripts/maintenance.sh status           HTTP code of each site, state of each Node container, switch on/off
#
# The page is docker/nginx/snippets/maintenance.html, served by snippets/maintenance.conf while snippets/maintenance.on
# exists; nginx checks the file per request, so no reload is needed either way.
#
# ORDER MATTERS. spheroseg-nginx resolves its upstream names (backend, maptimize-frontend, ...) when it loads its
# config: with those containers stopped, a reload is refused and a restart FAILS TO START, taking all three sites down
# hard. So this script never touches nginx, `on` puts the page up before it stops anything, and `off` removes the page
# only after every Node container reports healthy. While they are stopped, do not reload or restart spheroseg-nginx.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FLAG=$REPO/docker/nginx/snippets/maintenance.on
SITES=(spherosegapp.utia.cas.cz maptimize.utia.cas.cz curator.utia.cas.cz)
# container -> restart policy it has in its compose file (restored by `off`)
declare -A NODE=([spheroseg-backend]=always [maptimize-frontend]=unless-stopped [curator-backend]=unless-stopped)
WAIT_S=${WAIT_S:-180}

code() { curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$1:443:127.0.0.1" "https://$1/" || true; }
state() { docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$1" 2> /dev/null || echo missing; }

status() {
  for s in "${SITES[@]}"; do printf '%-28s HTTP %s\n' "$s" "$(code "$s")"; done
  for c in "${!NODE[@]}"; do printf '%-28s %s\n' "$c" "$(state "$c")"; done
  if [[ -f $FLAG ]]; then echo "maintenance page: ON"; else echo "maintenance page: off"; fi
}

case "${1:-status}" in
  on)
    touch "$FLAG"
    sleep 1
    for s in "${SITES[@]}"; do
      [[ $(code "$s") == 503 ]] || echo "warning: $s does not answer 503 yet (is spheroseg-nginx running?)"
    done
    if [[ ${2:-} == --stop-node ]]; then
      for c in "${!NODE[@]}"; do
        docker update --restart=no "$c" > /dev/null # a daemon restart must not bring it back
        docker stop "$c" > /dev/null && echo "stopped $c"
      done
      echo "Node containers stopped. Do not reload or restart spheroseg-nginx until '$0 off'."
    fi
    status
    ;;
  off)
    for c in "${!NODE[@]}"; do
      [[ $(state "$c") == missing ]] && {
        echo "$c does not exist (removed, not stopped): recreate it with its compose file first; page stays ON"
        exit 1
      }
      docker update --restart="${NODE[$c]}" "$c" > /dev/null
      [[ $(docker inspect -f '{{.State.Status}}' "$c") == running ]] || { docker start "$c" > /dev/null && echo "started $c"; }
    done
    deadline=$((SECONDS + WAIT_S))
    for c in "${!NODE[@]}"; do
      until [[ $(state "$c") == "running healthy" ]]; do
        ((SECONDS < deadline)) || { echo "$c is not healthy after ${WAIT_S}s ($(state "$c")): page stays ON, see docker logs $c"; exit 1; }
        sleep 3
      done
    done
    rm -f "$FLAG"
    sleep 1
    status
    ;;
  status) status ;;
  *)
    sed -n '2,9p' "$0"
    exit 2
    ;;
esac
