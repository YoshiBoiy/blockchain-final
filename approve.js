const { ethers } = require("ethers");

const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const BUZZ_TOKEN_ADDRESS =
    process.env.BUZZ_TOKEN_ADDRESS ||
    process.env.BUZZTOKEN ||
    "0x26b7bbf61eAf8Aa9b4b6919593A3272DadE22705";
const CARNIVAL_ADDRESS =
    process.env.CARNIVAL_ADDRESS || "0x912065165C9381732d694C9699e62B2bb02Fd999";

const abi = [
    "function approve(address spender, uint256 amount) external returns (bool)",
];

async function main() {
    if (!RPC_URL || !PRIVATE_KEY) {
        console.error(
            "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY, e.g.:\n" +
                "  set -a && source .env.local && set +a && node approve.js"
        );
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const buzzTokenContract = new ethers.Contract(BUZZ_TOKEN_ADDRESS, abi, wallet);

    console.log(`Loaded wallet: ${wallet.address}`);
    console.log(`Approving Carnival (${CARNIVAL_ADDRESS}) to spend BUZZ...`);

    const tx = await buzzTokenContract.approve(CARNIVAL_ADDRESS, ethers.MaxUint256);
    console.log(`Transaction submitted! Hash: ${tx.hash}`);
    await tx.wait(1);
    console.log("SUCCESS: Approval confirmed on-chain.");
}

main().catch(console.error);
