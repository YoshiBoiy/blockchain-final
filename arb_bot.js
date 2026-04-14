const { ethers } = require("ethers");

// ============================================
// CONFIGURATION
// ============================================
const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Contract Addresses
const DEX1_ADDRESS = "0xCadcEC3A21dCF45044adB463d865ce7c2B4B6971"; // BuzzSwap
const DEX2_ADDRESS = "0x34272af214ae055F37eF75d948Cded8c59627448"; // BullMarket
const BUZZ_ADDRESS = "0x26b7bbf61eAf8Aa9b4b6919593A3272DadE22705";
const BULL_ADDRESS = "0xf8c42e0E0F895ECaAAA1a7737731DbdD06861DAF";

// ABIs
const dexAbi = [
    "function previewSwapAforB(uint256 amountAIn) external view returns (uint256)",
    "function previewSwapBforA(uint256 amountBIn) external view returns (uint256)",
    "function swapAforB(uint256 amountAIn) external returns (uint256)",
    "function swapBforA(uint256 amountBIn) external returns (uint256)"
];

const tokenAbi = [
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)"
];

async function ensureApproval(tokenContract, dexAddress, tokenName, dexName) {
    const allowance = await tokenContract.allowance(tokenContract.runner.address, dexAddress);
    if (allowance < ethers.parseEther("1000")) {
        console.log(`Approving ${dexName} to spend ${tokenName}...`);
        const tx = await tokenContract.approve(dexAddress, ethers.MaxUint256);
        await tx.wait(1);
        console.log(`✅ Approved ${dexName} for ${tokenName}.`);
    }
}

async function main() {
    if (!RPC_URL || !PRIVATE_KEY) {
        console.error(
            "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY, e.g.:\n" +
                "  set -a && source .env.local && set +a && node arb_bot.js"
        );
        process.exit(1);
    }

    console.log("Initializing Arbitrage Bot...");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    const dex1 = new ethers.Contract(DEX1_ADDRESS, dexAbi, wallet);
    const dex2 = new ethers.Contract(DEX2_ADDRESS, dexAbi, wallet);
    const buzzToken = new ethers.Contract(BUZZ_ADDRESS, tokenAbi, wallet);
    const bullToken = new ethers.Contract(BULL_ADDRESS, tokenAbi, wallet);

    console.log(`Wallet loaded: ${wallet.address}`);

    // 1. Run Permissions Setup
    await ensureApproval(buzzToken, DEX1_ADDRESS, "BUZZ", "BuzzSwap");
    await ensureApproval(bullToken, DEX1_ADDRESS, "BULL", "BuzzSwap");
    await ensureApproval(buzzToken, DEX2_ADDRESS, "BUZZ", "BullMarket");
    await ensureApproval(bullToken, DEX2_ADDRESS, "BULL", "BullMarket");

    let isTrading = false;

    console.log("✅ Setup Complete. Listening for Arbitrage Opportunities...\n");

    // 2. Loop & Monitor each block
    provider.on("block", async (blockNumber) => {
        if (isTrading) return; // Prevent spamming concurrent trades
        
        try {
            // Check how much BUZZ we actually have available to trade
            const myBuzzBal = await buzzToken.balanceOf(wallet.address);
            if (myBuzzBal === 0n) return;

            // Generate potential trade sizes (e.g. 5, 10, 25, 50 BUZZ)
            let sizes = [5n, 10n, 25n, 50n, 100n].map(n => n * 10n ** 18n);
            sizes = sizes.filter(size => size <= myBuzzBal);
            if (sizes.length === 0) sizes = [myBuzzBal]; // If we have e.g. 3 BUZZ, test 3 BUZZ

            let bestProfit = 0n;
            let bestAmountIn = 0n;
            let bestPath = 0; // 1 = DEX1->DEX2, 2 = DEX2->DEX1

            // 3. Test Trade Paths
            for (let amountIn of sizes) {
                // PATH 1: BuzzSwap -> BullMarket
                try {
                    const bullOut1 = await dex1.previewSwapAforB(amountIn);
                    const buzzOut1 = await dex2.previewSwapBforA(bullOut1);
                    if (buzzOut1 > amountIn) {
                        const profit = buzzOut1 - amountIn;
                        if (profit > bestProfit) {
                            bestProfit = profit;
                            bestAmountIn = amountIn;
                            bestPath = 1;
                        }
                    }
                } catch (e) {} // Ignore execution reverting if liquidity is low

                // PATH 2: BullMarket -> BuzzSwap
                try {
                    const bullOut2 = await dex2.previewSwapAforB(amountIn);
                    const buzzOut2 = await dex1.previewSwapBforA(bullOut2);
                    if (buzzOut2 > amountIn) {
                        const profit = buzzOut2 - amountIn;
                        if (profit > bestProfit) {
                            bestProfit = profit;
                            bestAmountIn = amountIn;
                            bestPath = 2;
                        }
                    }
                } catch (e) {}
            }

            // 4. Execute Trade if profitable (target > 0.05 BUZZ profit to counter any slippage)
            if (bestProfit > ethers.parseEther("0.05")) {
                isTrading = true;
                const pathName = bestPath === 1 ? "BuzzSwap -> BullMarket" : "BullMarket -> BuzzSwap";
                const fmtIn = ethers.formatEther(bestAmountIn);
                const fmtProf = ethers.formatEther(bestProfit);
                
                console.log(`\n🎉 Arb Found at Block ${blockNumber}!`);
                console.log(`PATH: ${pathName}`);
                console.log(`TRADE SIZE: ${fmtIn} BUZZ`);
                console.log(`EXPECTED PROFIT: ${fmtProf} BUZZ`);
                console.log(`Executing trades now...`);

                try {
                    if (bestPath === 1) {
                        // Leg 1
                        console.log("-> Swapping BUZZ for BULL on BuzzSwap...");
                        let tx1 = await dex1.swapAforB(bestAmountIn);
                        await tx1.wait(1);

                        // Leg 2
                        console.log("-> Swapping BULL back for BUZZ on BullMarket...");
                        let bullBal = await bullToken.balanceOf(wallet.address);
                        let tx2 = await dex2.swapBforA(bullBal);
                        await tx2.wait(1);
                    } else {
                        // Leg 1
                        console.log("-> Swapping BUZZ for BULL on BullMarket...");
                        let tx1 = await dex2.swapAforB(bestAmountIn);
                        await tx1.wait(1);

                        // Leg 2
                        console.log("-> Swapping BULL back for BUZZ on BuzzSwap...");
                        let bullBal = await bullToken.balanceOf(wallet.address);
                        let tx2 = await dex1.swapBforA(bullBal);
                        await tx2.wait(1);
                    }
                    console.log(`✅ Arbitrage Successfully Executed and Cleared!\nListening for next opportunity...`);
                } catch (tradeErr) {
                    console.error("Trade Execution Failed. Perhaps someone else took the arb first?", tradeErr.message);
                }

                isTrading = false;
            }

        } catch (err) {
            console.error("Monitoring loop error:", err.message);
            isTrading = false;
        }
    });
}

main().catch(console.error);
