"use strict";

/**
 * King bot: watches the chain and submits KOTH_heartbeat() each interval.
 *
 * Revert deadline: block.number <= last_heartbeat_block + heartbeatInterval (inclusive).
 * "Late" (hurts quorum): block.number > last + heartbeatInterval - LATE_HEARTBEAT_THRESHOLD
 *   — with defaults, late is blocks last+41 … last+50 of each window, non-late is last+1 … last+40.
 *
 * This script fires when block >= last + heartbeatInterval - LATE_HEARTBEAT_THRESHOLD - HEARTBEAT_EARLY_MARGIN
 * so the tx lands in the non-late band by default (not merely "8 blocks before revert").
 *
 * Env: SEPOLIA_RPC_URL (or RPC_URL), PRIVATE_KEY
 * Optional: KOTH_ADDRESS, HEARTBEAT_EARLY_MARGIN (default 8), GAS_LIMIT
 *
 * Run: set -a && source .env.local && set +a && node koth_heartbeat_bot.js
 */

const { ethers } = require("ethers");

const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const KOTH_ADDRESS =
    process.env.KOTH_ADDRESS || "0xE92913e15BED6a5FC019d6EF258b2ECaB3B63845";

/** Blocks before the late zone starts: trigger at last + interval - lateThresh - margin. */
const EARLY_MARGIN_BLOCKS = Math.max(
    0,
    parseInt(process.env.HEARTBEAT_EARLY_MARGIN || "8", 10) || 8
);
const GAS_LIMIT = process.env.GAS_LIMIT ? BigInt(process.env.GAS_LIMIT) : null;

const kothAbi = [
    "function KOTH_heartbeat() external",
    "function king() view returns (address)",
    "function last_heartbeat_block() view returns (uint256)",
    "function heartbeatInterval() view returns (uint256)",
    "function LATE_HEARTBEAT_THRESHOLD() view returns (uint256)",
];

let sending = false;

async function main() {
    if (!RPC_URL || !PRIVATE_KEY) {
        console.error(
            "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY, e.g.:\n" +
                "  set -a && source .env.local && set +a && node koth_heartbeat_bot.js"
        );
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const koth = new ethers.Contract(KOTH_ADDRESS, kothAbi, wallet);

    const king = await koth.king();
    if (king.toLowerCase() !== wallet.address.toLowerCase()) {
        console.error(`Not king. king=${king} wallet=${wallet.address}`);
        process.exit(1);
    }

    const lateThresh = await koth.LATE_HEARTBEAT_THRESHOLD();
    console.log(`KOTH ${KOTH_ADDRESS}`);
    console.log(`Wallet (king): ${wallet.address}`);
    console.log(
        `Trigger: block >= last + interval - lateThreshold(${lateThresh}) - earlyMargin(${EARLY_MARGIN_BLOCKS}) (non-late band).`
    );

    const sendIfDue = async (blockNumber) => {
        if (sending) return;

        const last = await koth.last_heartbeat_block();
        const interval = await koth.heartbeatInterval();
        const deadline = last + interval;
        const bn = BigInt(blockNumber);

        if (bn > deadline) {
            console.error(
                `Heartbeat window expired. last_heartbeat_block=${last} interval=${interval} deadline=${deadline} head=${bn}`
            );
            process.exit(1);
        }

        const lastNonLate = last + interval - lateThresh;
        let triggerAt = lastNonLate - BigInt(EARLY_MARGIN_BLOCKS);
        const earliest = last + 1n;
        if (triggerAt < earliest) triggerAt = earliest;
        if (bn < triggerAt) {
            return;
        }

        sending = true;
        try {
            const opts = GAS_LIMIT ? { gasLimit: GAS_LIMIT } : {};
            const lateStart = last + interval - lateThresh + 1n; // first block where `late` is true
            console.log(
                `[block ${bn}] Sending KOTH_heartbeat() … (revert deadline ${deadline}, late from ${lateStart})`
            );
            const tx = await koth.KOTH_heartbeat(opts);
            console.log(`Submitted: ${tx.hash}`);
            await tx.wait(1);
            console.log("Heartbeat confirmed.");
        } catch (e) {
            console.error(e.shortMessage || e.message || e);
        } finally {
            sending = false;
        }
    };

    const head = await provider.getBlockNumber();
    await sendIfDue(head);

    provider.on("block", (bn) => {
        void sendIfDue(bn);
    });

    console.log("Subscribed to new blocks. Ctrl+C to stop.");

    process.on("SIGINT", () => {
        console.log("\nExiting.");
        process.exit(0);
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
