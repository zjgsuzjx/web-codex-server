#!/usr/bin/env bash
# Invoked through the existing worker's nsenter, only for this exact swap file.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
APP_DIR=${1:?Missing application directory}
ACTION=${2:?Missing action}
case "$APP_DIR" in /home/*/apps/web-codex-server) ;; *) exit 1;; esac
[[ "$(realpath -e "$APP_DIR")" == "$APP_DIR" ]]
STATE_DIR="$APP_DIR/.deploy-state"
[[ -d "$STATE_DIR" && ! -L "$STATE_DIR" && "$(realpath -e "$STATE_DIR")" == "$STATE_DIR" ]]
SWAP="$STATE_DIR/build.swap"
SIZE=2147483648
active() { swapon --show=NAME --noheadings | grep -Fxq "$SWAP"; }
validate() {
  [[ -f "$SWAP" && ! -L "$SWAP" && "$(stat -c '%u:%a:%s:%h' "$SWAP")" == "0:600:$SIZE:1" ]]
}
case "$ACTION" in
  create)
    [[ ! -e "$SWAP" && ! -L "$SWAP" ]]
    FREE=$(df -PB1 "$STATE_DIR" | awk 'NR==2 {print $4}')
    [[ "$FREE" -ge 5905580032 ]] || { echo 'Need 5.5 GiB free before temporary swap' >&2; exit 1; }
    (umask 077; set -C; : > "$SWAP")
    # A failed allocation/activation must not leave a partial private file.
    trap 'if ! active; then rm -f -- "$SWAP"; fi' EXIT
    fallocate -l "$SIZE" "$SWAP"
    validate
    mkswap "$SWAP" >/dev/null
    swapon --priority -3 "$SWAP"
    ;;
  remove)
    if [[ -e "$SWAP" || -L "$SWAP" ]]; then
      validate || { echo 'Refusing unexpected build swap file' >&2; exit 1; }
      if active; then swapoff "$SWAP"; fi
      rm -- "$SWAP"
    fi
    ;;
  *) exit 1;;
esac
