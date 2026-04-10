"use strict";

const { parentPort, workerData } = require("worker_threads");
const { ethers } = require("ethers");

const { workerId, numWorkers, d, addressHex } = workerData;
const mask = 1n << BigInt(d);
const coder = ethers.AbiCoder.defaultAbiCoder();
const addr = ethers.getAddress(addressHex);

const PROGRESS_EVERY = 2_000_000n;
let sinceProgress = 0n;

for (let nonce = BigInt(workerId); ; nonce += BigInt(numWorkers)) {
    const enc = coder.encode(["uint256", "address"], [nonce, addr]);
    const h = BigInt(ethers.keccak256(enc));
    if (h % mask === 0n) {
        parentPort.postMessage({ ok: true, nonce: nonce.toString() });
        return;
    }
    sinceProgress += 1n;
    if (sinceProgress >= PROGRESS_EVERY) {
        sinceProgress = 0n;
        // Only worker 0 logs — avoids 16× spam; all workers run the same loop in parallel (stride).
        if (workerId === 0) {
            parentPort.postMessage({ progress: true, nonce: nonce.toString(), workerId, numWorkers });
        }
    }
}
