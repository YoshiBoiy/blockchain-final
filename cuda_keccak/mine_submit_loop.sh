#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   set -a && source ../.env.local && set +a
#   ./mine_submit_loop.sh
#
# Optional overrides:
#   ADDRESS=0x... START_D=32 END_D=120 SUBMIT_SCRIPT=../submit.js ./mine_submit_loop.sh

ADDRESS="${ADDRESS:-0xDB1940e77471e238875c60716413137A4080428B}"
START_D="${START_D:-32}"
END_D="${END_D:-120}"
SUBMIT_SCRIPT="${SUBMIT_SCRIPT:-./submit.js}"

if [[ ! -x "./pay_to_mine_gpu" ]]; then
  echo "Missing ./pay_to_mine_gpu binary. Build first: make ARCH=sm_90"
  exit 1
fi

if [[ -z "${SEPOLIA_RPC_URL:-${RPC_URL:-}}" || -z "${PRIVATE_KEY:-}" ]]; then
  echo "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY in environment first."
  echo "Example: set -a && source ../.env.local && set +a"
  exit 1
fi

for ((d=START_D; d<=END_D; d++)); do
  echo
  echo "=== Mining d=${d} for ${ADDRESS} ==="
  nonce="$(./pay_to_mine_gpu "${ADDRESS}" "${d}" | awk 'NF{last=$0} END{print last}')"

  if [[ -z "${nonce}" || ! "${nonce}" =~ ^[0-9]+$ ]]; then
    echo "Failed to parse nonce from miner output at d=${d}."
    exit 1
  fi

  echo "Found nonce=${nonce}"
  echo "Submitting pay_to_mine(nonce=${nonce}, d=${d})..."
  node "${SUBMIT_SCRIPT}" "${nonce}" "${d}"
  echo "Done d=${d}. Continuing..."
done

echo
echo "Completed mining/submission loop through d=${END_D}."
