#!/usr/bin/env bash
set -euo pipefail

# Multi-GPU / multi-node miner coordinator using PostgreSQL (Azure Flexible Server friendly).
#
# Required env:
#   SEPOLIA_RPC_URL or RPC_URL, PRIVATE_KEY (used by ../submit.js)
#   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
#
# Recommended env for Azure:
#   PGSSLMODE=require
#
# Optional env:
#   PGTABLE=pay2mine_rounds
#   ADDRESS=0xDB1940e77471e238875c60716413137A4080428B
#   START_D=32
#   END_D=120
#   WORKER_INDEX=0
#   TOTAL_WORKERS=1
#   POLL_SEC=2
#   SUBMIT_SCRIPT=../submit.js
#   WORKER_ID=<hostname-wX>

ADDRESS="${ADDRESS:-0xDB1940e77471e238875c60716413137A4080428B}"
START_D="${START_D:-32}"
END_D="${END_D:-120}"
WORKER_INDEX="${WORKER_INDEX:-0}"
TOTAL_WORKERS="${TOTAL_WORKERS:-1}"
POLL_SEC="${POLL_SEC:-2}"
SUBMIT_SCRIPT="${SUBMIT_SCRIPT:-../submit.js}"
PGTABLE="${PGTABLE:-pay2mine_rounds}"
WORKER_ID="${WORKER_ID:-$(hostname)-w${WORKER_INDEX}}"

if [[ ! -x "./pay_to_mine_gpu" ]]; then
  echo "Missing ./pay_to_mine_gpu. Build first: make ARCH=sm_89 (or your arch)."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required (install PostgreSQL client tools)."
  exit 1
fi

if [[ -z "${SEPOLIA_RPC_URL:-${RPC_URL:-}}" || -z "${PRIVATE_KEY:-}" ]]; then
  echo "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY first."
  echo "Example: set -a && source ../.env.local && set +a"
  exit 1
fi

for v in PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; do
  if [[ -z "${!v:-}" ]]; then
    echo "Missing required DB env var: $v"
    exit 1
  fi
done

if (( TOTAL_WORKERS < 1 )); then
  echo "TOTAL_WORKERS must be >= 1"
  exit 1
fi
if (( WORKER_INDEX < 0 || WORKER_INDEX >= TOTAL_WORKERS )); then
  echo "WORKER_INDEX must satisfy 0 <= WORKER_INDEX < TOTAL_WORKERS"
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

psqlq() {
  psql -X -v ON_ERROR_STOP=1 -qAt "$@"
}

# Ensure table exists (safe idempotent bootstrap).
psqlq <<SQL
CREATE TABLE IF NOT EXISTS ${PGTABLE} (
  d          INTEGER PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'mining',
  winner     TEXT,
  nonce      NUMERIC(78,0),
  txhash     TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

for ((d=START_D; d<=END_D; d++)); do
  echo
  echo "=== [${WORKER_ID}] round d=${d} ==="

  # Initialize row if absent.
  psqlq <<SQL
INSERT INTO ${PGTABLE}(d, status, updated_at)
VALUES (${d}, 'mining', NOW())
ON CONFLICT (d) DO NOTHING;
SQL

  miner_out="${tmp_dir}/d${d}.out"
  miner_err="${tmp_dir}/d${d}.err"
  : >"$miner_out"
  : >"$miner_err"

  ./pay_to_mine_gpu "$ADDRESS" "$d" "$WORKER_INDEX" "$TOTAL_WORKERS" >"$miner_out" 2>"$miner_err" &
  miner_pid=$!

  should_wait_for_winner=false

  while kill -0 "$miner_pid" >/dev/null 2>&1; do
    row="$(psqlq -c "SELECT status, COALESCE(winner,'') FROM ${PGTABLE} WHERE d=${d};" || true)"
    status="${row%%|*}"
    winner="${row#*|}"
    if [[ "$status" == "submitting" || "$status" == "confirmed" ]]; then
      if [[ -n "$winner" && "$winner" != "$WORKER_ID" ]]; then
        echo "[${WORKER_ID}] d=${d} already claimed by ${winner}; stopping local miner."
        kill "$miner_pid" >/dev/null 2>&1 || true
        should_wait_for_winner=true
      fi
      break
    fi
    sleep "$POLL_SEC"
  done

  wait "$miner_pid" >/dev/null 2>&1 || true

  if [[ "$should_wait_for_winner" == "true" ]]; then
    while true; do
      status="$(psqlq -c "SELECT status FROM ${PGTABLE} WHERE d=${d};" || true)"
      if [[ "$status" == "confirmed" ]]; then
        echo "[${WORKER_ID}] observed confirmed d=${d}. moving to next round."
        break
      fi
      if [[ "$status" == "error" ]]; then
        echo "[${WORKER_ID}] observed error on d=${d}; stopping."
        exit 1
      fi
      sleep "$POLL_SEC"
    done
    continue
  fi

  nonce="$(awk 'NF{last=$0} END{print last}' "$miner_out")"
  if [[ -z "$nonce" || ! "$nonce" =~ ^[0-9]+$ ]]; then
    status_now="$(psqlq -c "SELECT status FROM ${PGTABLE} WHERE d=${d};" || true)"
    if [[ "$status_now" == "submitting" || "$status_now" == "confirmed" ]]; then
      echo "[${WORKER_ID}] no local nonce; another worker advanced d=${d}."
      continue
    fi
    echo "[${WORKER_ID}] failed to parse nonce at d=${d}."
    echo "--- miner stderr ---"
    awk '{print}' "$miner_err"
    exit 1
  fi

  # Atomic winner claim: only one row update wins.
  claim_result="$(psqlq <<SQL
WITH claimed AS (
  UPDATE ${PGTABLE}
     SET winner='${WORKER_ID}',
         nonce=${nonce},
         status='submitting',
         updated_at=NOW()
   WHERE d=${d}
     AND winner IS NULL
  RETURNING winner
)
SELECT COALESCE((SELECT winner FROM claimed),'');
SQL
)"

  if [[ "$claim_result" == "$WORKER_ID" ]]; then
    echo "[${WORKER_ID}] won race for d=${d}, nonce=${nonce}; submitting tx..."
    submit_log="${tmp_dir}/submit_d${d}.log"
    if node "$SUBMIT_SCRIPT" "$nonce" "$d" | tee "$submit_log"; then
      txhash="$(awk '/Tx submitted:/{print $3; exit}' "$submit_log")"
      psqlq <<SQL
UPDATE ${PGTABLE}
   SET status='confirmed',
       txhash='${txhash:-unknown}',
       updated_at=NOW()
 WHERE d=${d};
SQL
      echo "[${WORKER_ID}] confirmed d=${d}."
    else
      psqlq -c "UPDATE ${PGTABLE} SET status='error', updated_at=NOW() WHERE d=${d};"
      echo "[${WORKER_ID}] submit failed at d=${d}; marked error."
      exit 1
    fi
  else
    winner_now="$(psqlq -c "SELECT COALESCE(winner,'') FROM ${PGTABLE} WHERE d=${d};" || true)"
    echo "[${WORKER_ID}] found nonce but lost race to ${winner_now:-unknown}; waiting confirmation."
    while true; do
      status="$(psqlq -c "SELECT status FROM ${PGTABLE} WHERE d=${d};" || true)"
      if [[ "$status" == "confirmed" ]]; then
        echo "[${WORKER_ID}] observed confirmed d=${d}. moving on."
        break
      fi
      if [[ "$status" == "error" ]]; then
        echo "[${WORKER_ID}] observed error on d=${d}; stopping."
        exit 1
      fi
      sleep "$POLL_SEC"
    done
  fi
done

echo
echo "[${WORKER_ID}] completed rounds ${START_D}..${END_D}."
