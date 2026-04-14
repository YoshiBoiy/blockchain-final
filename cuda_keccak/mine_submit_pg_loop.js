#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const { Client } = require("pg");

const ADDRESS = process.env.ADDRESS || "0xDB1940e77471e238875c60716413137A4080428B";
const START_D = Number(process.env.START_D || "32");
const END_D = Number(process.env.END_D || "120");
const WORKER_INDEX = Number(process.env.WORKER_INDEX || "0");
const TOTAL_WORKERS = Number(process.env.TOTAL_WORKERS || "1");
const POLL_MS = Number(process.env.POLL_MS || "2000");
const PGTABLE = process.env.PGTABLE || "pay2mine_rounds";
const SUBMIT_SCRIPT = process.env.SUBMIT_SCRIPT || "../submit.js";
const WORKER_ID = process.env.WORKER_ID || `${process.env.HOSTNAME || "worker"}-w${WORKER_INDEX}`;

const RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${PGTABLE} (
      d          INTEGER PRIMARY KEY,
      status     TEXT NOT NULL DEFAULT 'mining',
      winner     TEXT,
      nonce      NUMERIC(78,0),
      txhash     TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function initRound(client, d) {
  await client.query(
    `INSERT INTO ${PGTABLE}(d, status, updated_at) VALUES ($1, 'mining', NOW()) ON CONFLICT (d) DO NOTHING`,
    [d]
  );
}

async function getRound(client, d) {
  const { rows } = await client.query(
    `SELECT status, COALESCE(winner, '') AS winner FROM ${PGTABLE} WHERE d = $1`,
    [d]
  );
  return rows[0] || { status: "mining", winner: "" };
}

async function claimWinner(client, d, nonce) {
  const { rowCount } = await client.query(
    `UPDATE ${PGTABLE}
        SET winner = $1, nonce = $2, status = 'submitting', updated_at = NOW()
      WHERE d = $3 AND winner IS NULL`,
    [WORKER_ID, nonce, d]
  );
  return rowCount === 1;
}

async function setStatus(client, d, status, txhash = null) {
  await client.query(
    `UPDATE ${PGTABLE}
        SET status = $1, txhash = COALESCE($2, txhash), updated_at = NOW()
      WHERE d = $3`,
    [status, txhash, d]
  );
}

function runMiner(d) {
  return new Promise((resolve, reject) => {
    const miner = spawn("./pay_to_mine_gpu", [ADDRESS, String(d), String(WORKER_INDEX), String(TOTAL_WORKERS)], {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    miner.stdout.on("data", (buf) => {
      stdout += buf.toString();
    });
    miner.stderr.on("data", (buf) => {
      stderr += buf.toString();
    });
    miner.on("error", reject);
    miner.on("close", () => {
      if (settled) return;
      settled = true;
      const lines = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (!/^\d+$/.test(last)) {
        reject(new Error(`Failed to parse nonce. stderr:\n${stderr}`));
        return;
      }
      resolve({ nonce: last, kill: () => miner.kill("SIGTERM") });
    });

    resolve({
      nonce: null,
      kill: () => miner.kill("SIGTERM"),
      waitNonce: async () => {
        await new Promise((res, rej) => {
          miner.on("close", () => res());
          miner.on("error", rej);
        });
        const lines = stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        const last = lines[lines.length - 1] || "";
        if (!/^\d+$/.test(last)) {
          throw new Error(`Failed to parse nonce. stderr:\n${stderr}`);
        }
        return last;
      },
    });
  });
}

function runSubmit(nonce, d) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, SUBMIT_SCRIPT);
    const p = spawn("node", [scriptPath, String(nonce), String(d)], {
      cwd: path.resolve(__dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (b) => {
      const s = b.toString();
      out += s;
      process.stdout.write(s);
    });
    p.stderr.on("data", (b) => {
      const s = b.toString();
      err += s;
      process.stderr.write(s);
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`submit failed (code=${code})`));
      const m = out.match(/Tx submitted:\s*(0x[a-fA-F0-9]+)/);
      resolve({ txhash: m ? m[1] : null, out, err });
    });
  });
}

async function main() {
  must(RPC_URL && PRIVATE_KEY, "Set SEPOLIA_RPC_URL (or RPC_URL) and PRIVATE_KEY first.");
  must(Number.isInteger(START_D) && Number.isInteger(END_D) && START_D >= 28 && END_D >= START_D, "Bad START_D/END_D");
  must(Number.isInteger(WORKER_INDEX) && Number.isInteger(TOTAL_WORKERS) && TOTAL_WORKERS > 0, "Bad worker shard config");
  must(WORKER_INDEX >= 0 && WORKER_INDEX < TOTAL_WORKERS, "WORKER_INDEX must be in [0, TOTAL_WORKERS)");

  const client = new Client({
    host: process.env.PGHOST,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });

  await client.connect();
  await ensureSchema(client);

  for (let d = START_D; d <= END_D; d++) {
    console.log(`\n=== [${WORKER_ID}] round d=${d} ===`);
    await initRound(client, d);

    const minerProc = spawn("./pay_to_mine_gpu", [ADDRESS, String(d), String(WORKER_INDEX), String(TOTAL_WORKERS)], {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let minerStdout = "";
    let minerStderr = "";
    minerProc.stdout.on("data", (b) => (minerStdout += b.toString()));
    minerProc.stderr.on("data", (b) => (minerStderr += b.toString()));

    let stopForOtherWinner = false;
    while (true) {
      if (minerProc.exitCode !== null) break;
      const r = await getRound(client, d);
      if ((r.status === "submitting" || r.status === "confirmed") && r.winner && r.winner !== WORKER_ID) {
        console.log(`[${WORKER_ID}] d=${d} claimed by ${r.winner}; stopping local miner.`);
        minerProc.kill("SIGTERM");
        stopForOtherWinner = true;
        break;
      }
      await sleep(POLL_MS);
    }
    await new Promise((res) => minerProc.on("close", () => res()));

    if (stopForOtherWinner) {
      while (true) {
        const r = await getRound(client, d);
        if (r.status === "confirmed") break;
        if (r.status === "error") throw new Error(`Round d=${d} entered error state`);
        await sleep(POLL_MS);
      }
      continue;
    }

    const nonce = minerStdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(-1)[0];
    if (!nonce || !/^\d+$/.test(nonce)) {
      const r = await getRound(client, d);
      if (r.status === "submitting" || r.status === "confirmed") continue;
      throw new Error(`Failed to parse nonce for d=${d}. stderr:\n${minerStderr}`);
    }

    const won = await claimWinner(client, d, nonce);
    if (won) {
      console.log(`[${WORKER_ID}] won race for d=${d}, nonce=${nonce}; submitting...`);
      try {
        const { txhash } = await runSubmit(nonce, d);
        await setStatus(client, d, "confirmed", txhash || "unknown");
      } catch (e) {
        await setStatus(client, d, "error");
        throw e;
      }
    } else {
      const r = await getRound(client, d);
      console.log(`[${WORKER_ID}] found nonce but lost race to ${r.winner || "unknown"}; waiting...`);
      while (true) {
        const rr = await getRound(client, d);
        if (rr.status === "confirmed") break;
        if (rr.status === "error") throw new Error(`Round d=${d} entered error state`);
        await sleep(POLL_MS);
      }
    }
  }

  await client.end();
  console.log(`\n[${WORKER_ID}] completed rounds ${START_D}..${END_D}.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
