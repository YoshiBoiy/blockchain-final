const { ethers } = require("ethers");

const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const BUZZ_TOKEN_ADDRESS =
    process.env.BUZZ_TOKEN_ADDRESS ||
    process.env.BUZZTOKEN ||
    "0x26b7bbf61eAf8Aa9b4b6919593A3272DadE22705";
const KOTH_ADDRESS =
    process.env.KOTH_ADDRESS || "0xE92913e15BED6a5FC019d6EF258b2ECaB3B63845";

const buzzAbi = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
];
const kothAbi = [
    "function currentCoupCost() view returns (uint256)",
    "function KOTH_coup() external",
    "function perm(address) view returns (bool)",
    "function king() view returns (address)",
];

async function main() {
    if (!RPC_URL || !PRIVATE_KEY) {
        console.error(
            "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY, e.g.:\n" +
                "  set -a && source .env.local && set +a && node koth_coup.js"
        );
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const buzz = new ethers.Contract(BUZZ_TOKEN_ADDRESS, buzzAbi, wallet);
    const koth = new ethers.Contract(KOTH_ADDRESS, kothAbi, wallet);

    console.log(`Wallet: ${wallet.address}`);
    console.log(`KOTH:   ${KOTH_ADDRESS}`);

    const allowed = await koth.perm(wallet.address);
    if (!allowed) {
        console.error(
            "This wallet is not on the KOTH whitelist (perm[addr]=false). KOTH_coup will revert NotPermitted."
        );
        process.exit(1);
    }

    const king = await koth.king();
    if (king.toLowerCase() === wallet.address.toLowerCase()) {
        console.error("You are already king. KOTH_coup will revert AlreadyKing.");
        process.exit(1);
    }

    const cost = await koth.currentCoupCost();
    console.log(`Current coup cost: ${ethers.formatEther(cost)} BUZZ`);

    const allowance = await buzz.allowance(wallet.address, KOTH_ADDRESS);
    if (allowance < cost) {
        console.log("Approving KOTH to spend BUZZ...");
        const approveTx = await buzz.approve(KOTH_ADDRESS, ethers.MaxUint256);
        console.log(`Approve submitted: ${approveTx.hash}`);
        await approveTx.wait(1);
        console.log("Approve confirmed.");
    } else {
        console.log("Allowance sufficient; skipping approve.");
    }

    console.log("Sending KOTH_coup()...");
    const tx = await koth.KOTH_coup();
    console.log(`Transaction submitted: ${tx.hash}`);
    await tx.wait(1);
    console.log("SUCCESS: KOTH_coup confirmed.");
}

main().catch((e) => {
    console.error(e.shortMessage || e.message || e);
    process.exit(1);
});
