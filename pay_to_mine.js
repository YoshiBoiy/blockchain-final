"use strict";

/**
 * Pay-to-mine: climb d by 1 each successful on-chain step to maximize total BUZZ.
 *
 * ## Suggested cloud / Colab resources (this script = CPU + Node workers only)
 *
 * | Resource        | Practical choice |
 * |----------------|------------------|
 * | Accelerator    | **1× NVIDIA A100 80GB** (or L40S / H100 if cheaper per FLOP). Keccak is compute-bound; **80GB VRAM is not required**—16GB is plenty if you later add CUDA. |
 * | CPU            | **16–32 cores** to feed multiple workers and the RPC stack. |
 * | # GPUs         | **1** for a future CUDA port; this JS miner uses **CPU only**. |
 * | System RAM     | **16 GB** comfortable; **8 GB** minimum. |
 * | Wall time      | Expect **~0.5–2 h** for d≈28–30 with 16 CPU workers; each +1 to **d** ≈ **doubles** expected hashes (~2^d). Budget **several hours per step** as d grows, or **4–24 h** for a deep run without GPU kernels. |
 *
 * Env: same as approve.js (PRIVATE_KEY, SEPOLIA_RPC_URL). Optional:
 *   WORKERS        - worker thread count (default: min(16, cpus))
 *   MAX_STEPS      - stop after this many successful level-ups (default: unlimited)
 *   STATE_FILE     - JSON path for lastSuccessfulD (default: ./pay_to_mine_state.json); written after success
 *   FORCE_LAST_D   - if set, override on-chain read (debug / unusual layouts)
 *   GAS_LIMIT      - gas for pay_to_mine tx (default: 500000)
 *   DRY_RUN        - if "1", mine first d only, print nonce, do not send tx
 *
 * Run: set -a && source .env.local && set +a && node pay_to_mine.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker } = require("worker_threads");
const { ethers, isError } = require("ethers");

const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CARNIVAL_ADDRESS =
    process.env.CARNIVAL_ADDRESS || "0x912065165C9381732d694C9699e62B2bb02Fd999";
const BUZZ_TOKEN_ADDRESS =
    process.env.BUZZ_TOKEN_ADDRESS ||
    process.env.BUZZTOKEN ||
    "0x26b7bbf61eAf8Aa9b4b6919593A3272DadE22705";

const STATE_FILE = path.resolve(process.env.STATE_FILE || "pay_to_mine_state.json");
const NUM_WORKERS = Math.max(
    1,
    Math.min(
        parseInt(process.env.WORKERS || String(Math.min(16, os.cpus().length)), 10) || 1,
        256
    )
);
let MAX_STEPS = Number.POSITIVE_INFINITY;
if (process.env.MAX_STEPS) {
    const n = parseInt(process.env.MAX_STEPS, 10);
    if (Number.isFinite(n) && n > 0) {
        MAX_STEPS = n;
    }
}
const GAS_LIMIT = BigInt(process.env.GAS_LIMIT || "500000");
const DRY_RUN = process.env.DRY_RUN === "1";

const carnivalAbi = ["function pay_to_mine(uint256 nonce, uint256 d) external"];

/** `previous_max` mapping base slot in BuzzCarnival.sol (0.8 layout, do not change if contract changes). */
const PREVIOUS_MAX_MAPPING_SLOT = 10n;

async function readPreviousMaxFromChain(provider, carnivalAddr, userAddr) {
    const enc = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [ethers.getAddress(userAddr), PREVIOUS_MAX_MAPPING_SLOT]
    );
    const key = ethers.keccak256(enc);
    const word = await provider.getStorage(carnivalAddr, key);
    return BigInt(word);
}

function readStateFileLastD() {
    try {
        const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        return BigInt(j.lastSuccessfulD || "0");
    } catch {
        return 0n;
    }
}

function saveState(lastSuccessfulD) {
    fs.writeFileSync(
        STATE_FILE,
        JSON.stringify({ lastSuccessfulD: lastSuccessfulD.toString(), updatedAt: new Date().toISOString() }, null, 2),
        "utf8"
    );
}

function nextDifficulty(lastSuccessfulD) {
    if (lastSuccessfulD === 0n) {
        return 28n;
    }
    return lastSuccessfulD + 1n;
}

function mineNonceParallel(d, address) {
    return new Promise((resolve, reject) => {
        const workers = [];
        let settled = false;

        const cleanup = () => {
            for (const w of workers) {
                try {
                    w.terminate();
                } catch {
                    /* ignore */
                }
            }
        };

        for (let i = 0; i < NUM_WORKERS; i++) {
            const w = new Worker(path.join(__dirname, "pay_to_mine_worker.js"), {
                workerData: {
                    workerId: i,
                    numWorkers: NUM_WORKERS,
                    d,
                    addressHex: address,
                },
            });
            w.on("message", (msg) => {
                if (settled) return;
                if (msg.ok) {
                    settled = true;
                    cleanup();
                    resolve(msg.nonce);
                } else if (msg.progress && msg.workerId === 0) {
                    const nw = msg.numWorkers ?? NUM_WORKERS;
                    console.log(
                        `    … d=${d}: worker0 nonce≈${msg.nonce} (all ${nw} workers mining; this is only worker0's lane)`
                    );
                }
            });
            w.on("error", (err) => {
                if (!settled) {
                    settled = true;
                    cleanup();
                    reject(err);
                }
            });
            w.on("exit", (code) => {
                if (code !== 0 && !settled) {
                    settled = true;
                    cleanup();
                    reject(new Error(`Worker exited with code ${code}`));
                }
            });
            workers.push(w);
        }
    });
}

async function main() {
    if (!RPC_URL || !PRIVATE_KEY) {
        console.error(
            "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY, e.g.:\n" +
                "  set -a && source .env.local && set +a && node pay_to_mine.js"
        );
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const carnival = new ethers.Contract(CARNIVAL_ADDRESS, carnivalAbi, wallet);
    const buzzToken = new ethers.Contract(
        BUZZ_TOKEN_ADDRESS,
        ["function allowance(address owner, address spender) view returns (uint256)"],
        provider
    );

    console.log(`Wallet: ${wallet.address}`);
    console.log(`Workers: ${NUM_WORKERS} | state file: ${STATE_FILE}`);

    const allowance = await buzzToken.allowance(wallet.address, CARNIVAL_ADDRESS);
    if (allowance < ethers.parseEther("1")) {
        console.error("Allowance < 1 BUZZ. Run approve.js first.");
        process.exit(1);
    }

    let lastD;
    if (process.env.FORCE_LAST_D !== undefined && process.env.FORCE_LAST_D !== "") {
        lastD = BigInt(process.env.FORCE_LAST_D);
        console.log(`Using FORCE_LAST_D=${lastD} (skipping chain read)`);
    } else {
        const onChain = await readPreviousMaxFromChain(provider, CARNIVAL_ADDRESS, wallet.address);
        const fileD = readStateFileLastD();
        lastD = onChain;
        console.log(`On-chain previous_max (confirmed last d): ${onChain}`);
        if (fileD !== onChain) {
            console.log(
                `Note: ${STATE_FILE} had lastSuccessfulD=${fileD} — ignoring file; new machines must use chain state or they repeat d and revert with "Must exceed previous difficulty".`
            );
        }
    }

    let stepsDone = 0;
    while (stepsDone < MAX_STEPS) {
        const d = nextDifficulty(lastD);
        if (d > 255n) {
            console.error("d > 255 unsafe for 1<<d in EVM; stopping.");
            break;
        }

        const payoutBuzz = 5n * (d - 27n);
        console.log(`\n=== Mining for d=${d} (payout on success: ${payoutBuzz} BUZZ, fee: 1 BUZZ) ===`);
        console.log(
            `Using ${NUM_WORKERS} CPU worker threads in parallel (Node/ethers; GPU not used). ` +
                `Progress lines show worker 0's current nonce only (~every 2M hashes on that lane); other workers scan other nonce residues in parallel.`
        );
        const t0 = Date.now();
        const nonceStr = await mineNonceParallel(d, wallet.address);
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`Found nonce=${nonceStr} in ${sec}s (wall clock, ${NUM_WORKERS} workers)`);

        if (DRY_RUN) {
            console.log("DRY_RUN=1 — not sending transaction.");
            break;
        }

        try {
            await carnival.pay_to_mine.staticCall(nonceStr, d, { from: wallet.address });
        } catch (pre) {
            console.error("Preflight simulation reverted (on-chain would fail). Common cause: d is not > previous_max.");
            console.error(pre.shortMessage || pre.message);
            process.exit(1);
        }

        const tx = await carnival.pay_to_mine(nonceStr, d, { gasLimit: GAS_LIMIT });
        console.log(`Submitted: ${tx.hash}`);
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
            console.error(
                "Transaction failed — not updating state. If gas used ≈ gas limit, raise GAS_LIMIT; otherwise check explorer revert reason."
            );
            process.exit(1);
        }

        lastD = d;
        saveState(lastD);
        console.log(`Confirmed. Saved lastSuccessfulD=${lastD}.`);
        stepsDone++;
    }

    console.log("\nDone.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
