const { ethers, isError } = require("ethers");

// Load from environment (e.g. `set -a && source .env.local && set +a && node guess_bot.js`)
const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CARNIVAL_ADDRESS =
    process.env.CARNIVAL_ADDRESS || "0x912065165C9381732d694C9699e62B2bb02Fd999";
const BUZZ_TOKEN_ADDRESS =
    process.env.BUZZ_TOKEN_ADDRESS ||
    process.env.BUZZTOKEN ||
    "0x26b7bbf61eAf8Aa9b4b6919593A3272DadE22705";

const carnivalAbi = [
    "function guess_the_number(uint256 nonce) external",
];

async function calculateWinningNonce(callerAddress, targetBlockNumber) {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const targetBn = BigInt(targetBlockNumber);

    let encoded = coder.encode(["address"], [callerAddress]);
    let temp = ethers.keccak256(encoded);

    encoded = coder.encode(["uint256", "uint256"], [temp, targetBn]);
    temp = ethers.keccak256(encoded);

    encoded = coder.encode(["uint256", "uint256"], [temp, temp]);
    temp = ethers.keccak256(encoded);

    return BigInt(temp) % 100n;
}

async function main() {
    if (!RPC_URL || !PRIVATE_KEY) {
        console.error(
            "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY, e.g.:\n" +
                "  set -a && source .env.local && set +a && node guess_bot.js"
        );
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const carnivalContract = new ethers.Contract(CARNIVAL_ADDRESS, carnivalAbi, wallet);
    const buzzToken = new ethers.Contract(
        BUZZ_TOKEN_ADDRESS,
        ["function allowance(address owner, address spender) view returns (uint256)"],
        provider
    );

    console.log(`Loaded wallet: ${wallet.address}`);

    const allowance = await buzzToken.allowance(wallet.address, CARNIVAL_ADDRESS);
    const oneBuzz = ethers.parseEther("1");
    if (allowance < oneBuzz) {
        console.error(
            `Allowance is ${allowance.toString()} wei; need at least 1 BUZZ. Run approve.js first and wait for confirmation.`
        );
        process.exit(1);
    }
    console.log("Allowance OK (>= 1 BUZZ).");

    console.log("Listening for new blocks on Sepolia...");

    let attempts = 0;
    const MAX_ATTEMPTS = 25;
    let busy = false;

    provider.on("block", async (blockNumber) => {
        if (busy || attempts >= MAX_ATTEMPTS) {
            if (attempts >= MAX_ATTEMPTS) {
                console.log("\nReached maximum allowed attempts. Exiting bot...");
                provider.removeAllListeners();
                process.exit(0);
            }
            return;
        }

        busy = true;
        const targetBlock = BigInt(blockNumber) + 1n;
        console.log(
            `\nNew Block Detected: ${blockNumber}. Targeting execution in block: ${targetBlock}`
        );

        try {
            const predictedNonce = await calculateWinningNonce(wallet.address, targetBlock);
            console.log(
                `[Attempt ${attempts + 1}] Predicted winning nonce for block ${targetBlock}: ${predictedNonce}`
            );

            // eth_call / staticCall uses state at end of the *previous* block while still using
            // block.number = targetBlock. It does NOT see BUZZ balance after earlier txs in the
            // same block—so it can pass even when a real win reverts (e.g. carnival < 5 BUZZ when
            // your tx runs late in the block). We only use this to catch hard reverts (perm, etc.).
            try {
                await carnivalContract.guess_the_number.staticCall(predictedNonce);
            } catch (simErr) {
                console.error("Pre-flight simulation reverted (will not send tx):");
                console.error(simErr.shortMessage || simErr.message);
                attempts++;
                return;
            }

            const feeData = await provider.getFeeData();
            const bump = BigInt(process.env.GAS_BUMP_PERCENT || "200");
            const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
                ? (feeData.maxPriorityFeePerGas * bump) / 100n
                : ethers.parseUnits("3", "gwei");
            const maxFeePerGas = feeData.maxFeePerGas
                ? (feeData.maxFeePerGas * bump) / 100n
                : undefined;

            // eth_estimateGas often simulates the *losing* path (wrong block.number in the node),
            // so the default ~49k limit is too small when you actually win (extra transfer + storage).
            // Without an explicit gasLimit, winning txs hit out-of-gas and revert (often shown as
            // ReentrancySentryOOG in traces).
            const gasLimit =
                process.env.GUESS_GAS_LIMIT != null
                    ? BigInt(process.env.GUESS_GAS_LIMIT)
                    : 250000n;

            const tx = await carnivalContract.guess_the_number(predictedNonce, {
                gasLimit,
                maxPriorityFeePerGas,
                ...(maxFeePerGas ? { maxFeePerGas } : {}),
            });
            attempts++;
            console.log(`Transaction submitted! Hash: ${tx.hash}`);
            console.log("Waiting for confirmation...");

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

            if (receipt.status === 0) {
                const idx = receipt.index;
                const minedInTarget = BigInt(receipt.blockNumber) === targetBlock;
                const limit = tx.gasLimit;
                const used = receipt.gasUsed;
                const likelyOog = limit != null && used >= limit - 1n;
                console.error("Transaction reverted on-chain.");
                if (likelyOog) {
                    console.error(
                        "Gas was fully used (likely OUT OF GAS). The network underestimated gas because " +
                            "the estimate often follows the *loss* path. This script sets gasLimit=250000 by default; " +
                            "raise GUESS_GAS_LIMIT if needed."
                    );
                } else if (minedInTarget) {
                    console.error(
                        "Landed in target block but reverted for another reason (e.g. carnival short on BUZZ for the " +
                            `5 BUZZ payout). Tx index: ${idx}.`
                    );
                } else {
                    console.error(
                        "Check allowance, max wins (gtm), or wrong block / nonce timing."
                    );
                }
                return;
            }

            const minedBlock = receipt.blockNumber;
            if (BigInt(minedBlock) === targetBlock) {
                console.log(
                    `SUCCESS: Tx mined in target block ${targetBlock}. If nonce matched, you won 5 BUZZ.`
                );
            } else {
                console.log(
                    `MISSED timing: Tx mined in block ${minedBlock} but math used block ${targetBlock}. ` +
                        `You paid 1 BUZZ unless the tx reverted. For a correct guess, the tx must execute in the same block number you used in the formula.`
                );
            }
        } catch (err) {
            console.error("Error during transaction:");
            console.error(err.shortMessage || err.message);
        } finally {
            busy = false;
        }
    });
}

main().catch(console.error);
