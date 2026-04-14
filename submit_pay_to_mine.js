const { ethers, isError } = require("ethers");

const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CARNIVAL_ADDRESS =
  process.env.CARNIVAL_ADDRESS || "0x912065165C9381732d694C9699e62B2bb02Fd999";
const GAS_LIMIT = BigInt(process.env.GAS_LIMIT || "500000");

const carnivalAbi = ["function pay_to_mine(uint256 nonce, uint256 d) external"];

function usageAndExit() {
  console.error(
    "Usage:\n" +
      "  node submit_pay_to_mine.js <nonce> <d>\n\n" +
      "Example:\n" +
      "  set -a && source .env.local && set +a && node submit_pay_to_mine.js 123456789 28"
  );
  process.exit(1);
}

async function main() {
  const nonceArg = process.argv[2];
  const dArg = process.argv[3];
  if (!nonceArg || !dArg) usageAndExit();
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY first.");
    process.exit(1);
  }

  const nonce = BigInt(nonceArg);
  const d = BigInt(dArg);
  if (d < 28n || d > 255n) {
    throw new Error("d must be in range [28, 255].");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const carnival = new ethers.Contract(CARNIVAL_ADDRESS, carnivalAbi, wallet);

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Submitting pay_to_mine(nonce=${nonce}, d=${d})...`);

  try {
    await carnival.pay_to_mine.staticCall(nonce, d, { from: wallet.address });
  } catch (pre) {
    console.error("Preflight simulation reverted; tx would fail.");
    console.error(pre.shortMessage || pre.message);
    process.exit(1);
  }

  const tx = await carnival.pay_to_mine(nonce, d, { gasLimit: GAS_LIMIT });
  console.log(`Tx submitted: ${tx.hash}`);

  let receipt;
  try {
    receipt = await tx.wait(1);
  } catch (e) {
    if (isError(e, "CALL_EXCEPTION") && e.receipt) {
      receipt = e.receipt;
    } else {
      throw e;
    }
  }

  if (receipt.status !== 1) {
    console.error("Transaction failed. Try higher GAS_LIMIT or verify nonce/difficulty.");
    process.exit(1);
  }

  console.log(`Confirmed in block ${receipt.blockNumber}.`);
  console.log(`Next difficulty target: d=${d + 1n}`);
  console.log(
    `Mine next: ./cuda_keccak/pay_to_mine_gpu ${wallet.address} ${d + 1n}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
