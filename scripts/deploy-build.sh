#!/usr/bin/env bash
# Sourced by deploy-release.sh. There is deliberately no unbounded fallback.
BUILD_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
BUILD_BUILDER=sv-codex-bounded-20261016
BUILD_CONTAINER="buildx_buildkit_${BUILD_BUILDER}0"
BUILD_IMAGE=moby/buildkit@sha256:6c2fa84a6b61ccd72899dde4239f8d5717f05f9a8ca6f3cad185fb1a95a94de3
BUILD_DEVICE=/dev/vda
BUILD_STARTED=false
BUILD_SWAP=false
BUILD_CACHE_DIRTY=false

build_swap() {
  local cid_file result=0 cid
  cid_file=$(mktemp "$STATE_DIR/swap-helper.XXXXXX")
  rm -- "$cid_file"
  timeout --signal=TERM --kill-after=15s 120s docker run --rm -i --network none --read-only \
    --cidfile "$cid_file" \
    --privileged --pid host --user 0:0 --memory 64m --cpus .25 --pids-limit 32 \
    --entrypoint /usr/bin/nsenter starvalley-codex-worker:local \
    --target=1 --mount --root -- /bin/bash -s -- "$APP_DIR" "$1" < "$BUILD_SCRIPT_DIR/deploy-swap.sh" || result=$?
  if [[ -f "$cid_file" ]]; then
    cid=$(cat "$cid_file")
    if [[ "$cid" =~ ^[0-9a-f]{64}$ ]]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
    rm -- "$cid_file"
  fi
  return "$result"
}

finish_build() {
  local result=0
  if [[ "$BUILD_STARTED" == true ]]; then
    docker exec "$BUILD_CONTAINER" cat /sys/fs/cgroup/memory.events || true
    if [[ "$BUILD_CACHE_DIRTY" == true ]]; then
      # Loaded release/rollback images live in Docker's image store. Only prune
      # this application's BuildKit cache, under the verified build limits.
      # Mark the attempt first so the EXIT trap never restarts a stopped builder.
      BUILD_CACHE_DIRTY=false
      echo "Clearing all reclaimable build cache: $BUILD_BUILDER"
      if timeout --signal=TERM --kill-after=10s 120s docker buildx prune --builder "$BUILD_BUILDER" --all --force; then
        echo 'Dedicated build cache cleanup completed'
      else
        echo 'Dedicated build cache cleanup failed; deployment cannot report success' >&2
        result=1
      fi
    fi
    if timeout --kill-after=10s 40s docker buildx stop "$BUILD_BUILDER"; then
      BUILD_STARTED=false
    else
      echo 'Could not stop dedicated builder; retaining swap for safety' >&2
      return 1
    fi
  fi
  if [[ "$BUILD_SWAP" == true ]]; then
    if build_swap remove; then BUILD_SWAP=false;
    else echo 'Build swap cleanup failed; inspect .deploy-state/build.swap' >&2; result=1; fi
  fi
  return "$result"
}

prepare_build() {
  local available swap_free free_bytes limits device io response
  available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  swap_free=$(awk '/SwapFree:/ {print $2}' /proc/meminfo)
  free_bytes=$(df -PB1 "$APP_DIR" | awk 'NR==2 {print $4}')
  echo "Build admission: available=${available}KiB swapFree=${swap_free}KiB diskFree=${free_bytes}B"
  [[ "$available" -ge 786432 && "$free_bytes" -ge 3758096384 ]] || {
    echo 'Build deferred: need 768 MiB available RAM and 3.5 GiB free disk' >&2; return 75;
  }
  # Stop an interrupted build before reclaiming its swap. Refuse a foreign image.
  if [[ -e "$STATE_DIR/build.swap" || -L "$STATE_DIR/build.swap" ]]; then
    if docker container inspect "$BUILD_CONTAINER" >/dev/null 2>&1; then
      [[ "$(docker inspect --format '{{.Config.Image}}' "$BUILD_CONTAINER")" == "$BUILD_IMAGE" ]]
      BUILD_STARTED=true
      finish_build
    fi
    build_swap remove
    available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
    swap_free=$(awk '/SwapFree:/ {print $2}' /proc/meminfo)
    free_bytes=$(df -PB1 "$APP_DIR" | awk 'NR==2 {print $4}')
  fi
  if [[ "$swap_free" -lt 2621440 || $((available + swap_free)) -lt 3407872 ]]; then
    [[ "$free_bytes" -ge 5905580032 ]] || { echo 'Insufficient disk for temporary build swap' >&2; return 75; }
    BUILD_SWAP=true
    build_swap create
  fi
  available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
  swap_free=$(awk '/SwapFree:/ {print $2}' /proc/meminfo)
  [[ "$available" -ge 786432 && "$swap_free" -ge 2621440 && $((available + swap_free)) -ge 3407872 ]] || {
    echo 'Insufficient memory/swap reserve; refusing to start the builder' >&2; return 75;
  }
  if docker buildx inspect "$BUILD_BUILDER" >/dev/null 2>&1; then
    [[ "$(docker inspect --format '{{.Config.Image}}' "$BUILD_CONTAINER")" == "$BUILD_IMAGE" ]] || {
      echo 'Unexpected dedicated builder image' >&2; return 1;
    }
    # Refresh only our builder's config while stopped, retaining its cache volume.
    BUILD_STARTED=true
    timeout --kill-after=10s 40s docker buildx stop "$BUILD_BUILDER"
    BUILD_STARTED=false
    docker cp "$BUILD_SCRIPT_DIR/../deploy/buildkitd.toml" "$BUILD_CONTAINER:/etc/buildkit/buildkitd.toml"
  else
    docker buildx create --name "$BUILD_BUILDER" --driver docker-container \
      --driver-opt "image=$BUILD_IMAGE,memory=1024m,memory-swap=3584m,cpu-quota=75000,cpu-period=100000,restart-policy=no" \
      --buildkitd-config "$BUILD_SCRIPT_DIR/../deploy/buildkitd.toml"
  fi
  BUILD_STARTED=true
  timeout --kill-after=10s 180s docker buildx inspect --bootstrap "$BUILD_BUILDER"
  docker update --memory 1024m --memory-swap 3584m --cpu-quota 75000 --cpu-period 100000 --pids-limit 256 --restart no "$BUILD_CONTAINER"
  limits=$(docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.CpuQuota}} {{.HostConfig.CpuPeriod}} {{.HostConfig.PidsLimit}}' "$BUILD_CONTAINER")
  [[ "$limits" == '1073741824 3758096384 75000 100000 256' ]] || { echo 'Builder limits did not apply' >&2; return 1; }
  # Verify actual cgroups, not only Buildx's saved driver options.
  [[ "$(docker exec "$BUILD_CONTAINER" cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max)" == $'1073741824\n2684354560\n75000 100000' ]]
  docker exec "$BUILD_CONTAINER" cat /etc/buildkit/buildkitd.toml | grep -Eq '^ *max-parallelism *= *1 *$'
  device=$(lsblk --nodeps --noheadings --raw --output MAJ:MIN "$BUILD_DEVICE")
  [[ "$device" =~ ^[0-9]+:[0-9]+$ ]]
  response=$(curl --fail --silent --show-error --max-time 15 --unix-socket /var/run/docker.sock \
    --request POST --header 'Content-Type: application/json' \
    --data "{\"BlkioDeviceReadBps\":[{\"Path\":\"$BUILD_DEVICE\",\"Rate\":50331648}],\"BlkioDeviceWriteBps\":[{\"Path\":\"$BUILD_DEVICE\",\"Rate\":25165824}]}" \
    "http://localhost/containers/$BUILD_CONTAINER/update")
  node -e 'const r=JSON.parse(process.argv[1]); if(r.Warnings?.length) throw Error(r.Warnings.join("; "))' "$response"
  io=$(docker exec "$BUILD_CONTAINER" cat /sys/fs/cgroup/io.max)
  [[ "$io" == "$device rbps=50331648 wbps=25165824 riops=max wiops=max" ]] || { echo 'Builder IO limits did not apply' >&2; return 1; }
  echo "Verified builder: RAM 1024 MiB, RAM+swap 3584 MiB, CPU 0.75, IO read 48/write 24 MiB/s"
  BUILD_DEADLINE=$(($(date +%s) + 1200))
}

build_image() {
  local remaining=$((BUILD_DEADLINE - $(date +%s)))
  [[ "$remaining" -gt 0 ]] || { echo 'Build time budget exhausted' >&2; return 124; }
  BUILD_CACHE_DIRTY=true
  timeout --signal=TERM --kill-after=20s "${remaining}s" docker buildx build \
    --builder "$BUILD_BUILDER" --load --progress plain "$@"
}
