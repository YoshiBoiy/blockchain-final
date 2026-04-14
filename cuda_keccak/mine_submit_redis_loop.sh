#!/usr/bin/env bash
set -euo pipefail

# Multi-GPU / multi-node miner coordinator using Redis.
# Each worker gets a unique residue class via START_NONCE and GLOBAL_STRIDE:
#   nonce = START_NONCE + k * GLOBAL_STRIDE
#
# Required env:
#   SEPOLIA_RPC_URL or RPC_URL, PRIVATE_KEY (used by ../submit.js)
#
# Optional env:
#   REDIS_URL=redis://127.0.0.1:6379
#   REDIS_PREFIX=buzz:pay2mine
#   ADDRESS=0xDB1940e77471e238875c60716413137A4080428B
#   START_D=32
#   END_D=120
#   WORKER_INDEX=0
#   TOTAL_WORKERS=1
#   ROUND_TTL_SEC=10800
#   POLL_SEC=2
#   SUBMIT_SCRIPT=../submit.js

ADDRESS="${ADDRESS:-0xDB1940e77471e238875c60716413137A4080428B}"
START_D="${START_D:-32}"
END_D="${END_D:-120}"
WORKER_INDEX="${WORKER_INDEX:-0}"
TOTAL_WORKERS="${TOTAL_WORKERS:-1}"
ROUND_TTL_SEC="${ROUND_TTL_SEC:-10800}"
POLL_SEC="${POLL_SEC:-2}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
REDIS_PREFIX="${REDIS_PREFIX:-buzz:pay2mine}"
SUBMIT_SCRIPT="${SUBMIT_SCRIPT:-../submit.js}"

if [[ ! -x "./pay_to_mine_gpu" ]]; then
  echo "Missing ./pay_to_mine_gpu. Build first: make ARCH=sm_89 (or your arch)."
  exit 1
fi

if ! command -v redis-cli >/dev/null 2>&1; then
  echo "redis-cli is required."
  exit 1
fi

if [[ -z "${SEPOLIA_RPC_URL:-${RPC_URL:-}}" || -z "${PRIVATE_KEY:-}" ]]; then
  echo "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY first."
  echo "Example: set -a && source ../.env.local && set +a"
  exit 1
fi

if (( TOTAL_WORKERS < 1 )); then
  echo "TOTAL_WORKERS must be >= 1"
  exit 1
fi

if (( WORKER_INDEX < 0 || WORKER_INDEX >= TOTAL_WORKERS )); then
  echo "WORKER_INDEX must satisfy 0 <= WORKER_INDEX < TOTAL_WORKERS"
  exit 1
fi

WORKER_ID="${WORKER_ID:-$(hostname)-w${WORKER_INDEX}}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

redis() {
  redis-cli -u "$REDIS_URL" --raw "$@"
}

round_key() {
  local d="$1"
  echo "${REDIS_PREFIX}:d:${d}"
}

for ((d=START_D; d<=END_D; d++)); do
  base="$(round_key "$d")"
  key_status="${base}:status"
  key_nonce="${base}:nonce"
  key_winner="${base}:winner"
  key_tx="${base}:txhash"
  key_time="${base}:updated_at"

  echo
  echo "=== [${WORKER_ID}] round d=${d} ==="

  # Round init (idempotent)
  redis SET "$key_status" "mining" NX EX "$ROUND_TTL_SEC" >/dev/null || true
  redis EXPIRE "$key_status" "$ROUND_TTL_SEC" >/dev/null || true
  redis SET "$key_time" "$(date -u +%FT%TZ)" EX "$ROUND_TTL_SEC" >/dev/null || true

  miner_out="${TMP_DIR}/d${d}.out"
  miner_err="${TMP_DIR}/d${d}.err"
  : >"$miner_out"
  : >"$miner_err"

  ./pay_to_mine_gpu "$ADDRESS" "$d" "$WORKER_INDEX" "$TOTAL_WORKERS" >"$miner_out" 2>"$miner_err" &
  miner_pid=$!

  should_continue_local=true
  while kill -0 "$miner_pid" >/dev/null 2>&1; do
    status="$(redis GET "$key_status" || true)"
    winner="$(redis GET "$key_winner" || true)"

    if [[ "$status" == "submitted" || "$status" == "confirmed" ]]; then
      if [[ -n "$winner" && "$winner" != "$WORKER_ID" ]]; then
        echo "[${WORKER_ID}] round d=${d} already won by ${winner}; stopping local miner."
        kill "$miner_pid" >/dev/null 2>&1 || true
        should_continue_local=false
      fi
      break
    fi
    sleep "$POLL_SEC"
  done

  wait "$miner_pid" >/dev/null 2>&1 || true

  if [[ "$should_continue_local" == "false" ]]; then
    # Wait for winner to confirm then move on.
    while true; do
      status="$(redis GET "$key_status" || true)"
      if [[ "$status" == "confirmed" ]]; then
        echo "[${WORKER_ID}] observed confirmed d=${d}. moving to next round."
        break
      fi
      sleep "$POLL_SEC"
    done
    continue
  fi

  nonce="$(awk 'NF{last=$0} END{print last}' "$miner_out")"
  if [[ -z "$nonce" || ! "$nonce" =~ ^[0-9]+$ ]]; then
    status_now="$(redis GET "$key_status" || true)"
    if [[ "$status_now" == "confirmed" || "$status_now" == "submitted" ]]; then
      echo "[${WORKER_ID}] no nonce locally; another worker already advanced round."
      continue
    fi
    echo "[${WORKER_ID}] failed to parse nonce for d=${d}."
    echo "--- miner stderr ---"
    awk '{print}' "$miner_err"
    exit 1
  fi

  # Atomic claim winner for this round.
  claimed="$(redis SET "$key_winner" "$WORKER_ID" NX EX "$ROUND_TTL_SEC" || true)"
  if [[ "$claimed" == "OK" ]]; then
    echo "[${WORKER_ID}] won race for d=${d}, nonce=${nonce}. submitting..."
    redis SET "$key_nonce" "$nonce" EX "$ROUND_TTL_SEC" >/dev/null || true
    redis SET "$key_status" "submitting" EX "$ROUND_TTL_SEC" >/dev/null || true
    redis SET "$key_time" "$(date -u +%FT%TZ)" EX "$ROUND_TTL_SEC" >/dev/null || true

    submit_log="${TMP_DIR}/submit_d${d}.log"
    if node "$SUBMIT_SCRIPT" "$nonce" "$d" | tee "$submit_log"; then
      txhash="$(awk '/Tx submitted:/{print $3; exit}' "$submit_log")"
      redis SET "$key_tx" "${txhash:-unknown}" EX "$ROUND_TTL_SEC" >/dev/null || true
      redis SET "$key_status" "confirmed" EX "$ROUND_TTL_SEC" >/dev/null || true
      redis SET "$key_time" "$(date -u +%FT%TZ)" EX "$ROUND_TTL_SEC" >/dev/null || true
      echo "[${WORKER_ID}] confirmed d=${d}. next round."
    else
      echo "[${WORKER_ID}] submit failed for d=${d}. marking round as error."
      redis SET "$key_status" "error" EX "$ROUND_TTL_SEC" >/dev/null || true
      exit 1
    fi
  else
    winner_now="$(redis GET "$key_winner" || true)"
    echo "[${WORKER_ID}] found nonce but lost winner race to ${winner_now:-unknown}; waiting confirmation."
    while true; do
      status="$(redis GET "$key_status" || true)"
      if [[ "$status" == "confirmed" ]]; then
        echo "[${WORKER_ID}] observed confirmed d=${d}. moving on."
        break
      fi
      if [[ "$status" == "error" ]]; then
        echo "[${WORKER_ID}] round d=${d} entered error state; stop and inspect winner logs."
        exit 1
      fi
      sleep "$POLL_SEC"
    done
  fi
done

echo
echo "[${WORKER_ID}] completed rounds ${START_D}..${END_D}."
