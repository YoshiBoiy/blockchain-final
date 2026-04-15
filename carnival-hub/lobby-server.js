"use strict";

/**
 * In-memory matchmaking for BuzzCarnival hub: duel 1v1 (2), highroller (2), mayor (5).
 * Run: npm install && npm run lobby
 */

const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const { ethers } = require("ethers");

const PORT = Number(process.env.LOBBY_PORT || 8787);

const CAPACITY = {
  duel1v1: 2,
  duel_highroller: 2,
  mayor_voting: 5,
};

/** @type {Record<string, Array<{ clientId: string, ws: import('ws'), address: string, mayorBidWei: string | null, game: string }>>} */
const queues = {
  duel1v1: [],
  duel_highroller: [],
  mayor_voting: [],
};

const AUTH_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const HEARTBEAT_STALE_MS = 45 * 1000;
const HEARTBEAT_SWEEP_MS = 15 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_JOINS = 5;

const ipJoinHistory = new Map();
const addressJoinHistory = new Map();

function log(event, fields = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

function nowMs() {
  return Date.now();
}

function pushAndPrune(historyMap, key, now) {
  const arr = historyMap.get(key) || [];
  const fresh = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  fresh.push(now);
  historyMap.set(key, fresh);
  return fresh.length;
}

function checkRateLimit(ip, address) {
  const now = nowMs();
  const ipCount = pushAndPrune(ipJoinHistory, ip || "unknown", now);
  const addrCount = pushAndPrune(addressJoinHistory, address, now);
  return ipCount <= RATE_LIMIT_MAX_JOINS && addrCount <= RATE_LIMIT_MAX_JOINS;
}

function makeChallenge(clientId, address) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const ts = nowMs();
  const msg =
    `BuzzLobby Auth\n` +
    `clientId:${clientId}\n` +
    `address:${address}\n` +
    `nonce:${nonce}\n` +
    `issuedAt:${ts}`;
  return { nonce, ts, msg };
}

function removeClientEverywhere(clientId) {
  for (const game of Object.keys(queues)) {
    queues[game] = queues[game].filter((e) => e.clientId !== clientId);
  }
}

function removeClosedSocketEntries() {
  for (const game of Object.keys(queues)) {
    queues[game] = queues[game].filter((e) => e.ws.readyState === 1);
  }
}

function broadcastQueueStatus(game) {
  const q = queues[game];
  const cap = CAPACITY[game];
  const payload = JSON.stringify({
    type: "queue_status",
    game,
    count: q.length,
    needed: cap,
  });
  for (const e of q) {
    if (e.ws.readyState === 1) {
      e.ws.send(payload);
    }
  }
}

function tryMatch(game) {
  const q = queues[game];
  const cap = CAPACITY[game];
  while (q.length >= cap) {
    const batch = q.splice(0, cap);
    const matchId = `${game}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const players = batch.map((b) => ({
      address: b.address,
      mayorBidWei: b.mayorBidWei,
    }));
    batch.forEach((entry, idx) => {
      if (entry.ws.readyState !== 1) return;
      entry.ws.send(
        JSON.stringify({
          type: "match_ready",
          game,
          matchId,
          yourIndex: idx,
          players,
        })
      );
    });
    broadcastQueueStatus(game);
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  let boundClientId = null;
  ws.__auth = {
    ok: false,
    address: null,
    clientId: null,
    challengeMsg: null,
    challengeIssuedAt: 0,
  };
  ws.__lastSeenAt = nowMs();
  ws.__ip = req && req.socket ? req.socket.remoteAddress : "unknown";
  log("ws_connected", { ip: ws.__ip });

  ws.on("message", (raw) => {
    ws.__lastSeenAt = nowMs();
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", ts: nowMs() }));
      return;
    }

    if (msg.type === "auth_hello") {
      const clientId = (msg.clientId || "").toString();
      const rawAddr = (msg.address || "").trim();
      if (!clientId || !/^0x[a-fA-F0-9]{40}$/.test(rawAddr)) {
        ws.send(JSON.stringify({ type: "auth_error", message: "auth_hello requires clientId + valid address" }));
        return;
      }
      const address = rawAddr.toLowerCase();
      const ch = makeChallenge(clientId, address);
      ws.__auth.ok = false;
      ws.__auth.address = address;
      ws.__auth.clientId = clientId;
      ws.__auth.challengeMsg = ch.msg;
      ws.__auth.challengeIssuedAt = ch.ts;
      ws.send(
        JSON.stringify({
          type: "auth_challenge",
          clientId,
          address,
          message: ch.msg,
          expiresInMs: AUTH_CHALLENGE_TTL_MS,
        })
      );
      return;
    }

    if (msg.type === "auth_response") {
      const clientId = (msg.clientId || "").toString();
      const rawAddr = (msg.address || "").trim();
      const signature = (msg.signature || "").toString();
      if (!clientId || !/^0x[a-fA-F0-9]{40}$/.test(rawAddr) || !signature) {
        ws.send(JSON.stringify({ type: "auth_error", message: "auth_response requires clientId/address/signature" }));
        return;
      }
      const address = rawAddr.toLowerCase();
      if (
        !ws.__auth.challengeMsg ||
        !ws.__auth.clientId ||
        ws.__auth.clientId !== clientId ||
        ws.__auth.address !== address
      ) {
        ws.send(JSON.stringify({ type: "auth_error", message: "No matching challenge for this client/address" }));
        return;
      }
      if (nowMs() - ws.__auth.challengeIssuedAt > AUTH_CHALLENGE_TTL_MS) {
        ws.send(JSON.stringify({ type: "auth_error", message: "Challenge expired. Send auth_hello again." }));
        return;
      }

      let recovered;
      try {
        recovered = ethers.verifyMessage(ws.__auth.challengeMsg, signature).toLowerCase();
      } catch {
        ws.send(JSON.stringify({ type: "auth_error", message: "Invalid signature format" }));
        return;
      }
      if (recovered !== address) {
        ws.send(JSON.stringify({ type: "auth_error", message: "Signature does not match address" }));
        return;
      }

      ws.__auth.ok = true;
      ws.__auth.address = address;
      ws.__auth.clientId = clientId;
      ws.send(JSON.stringify({ type: "auth_ok", address, clientId }));
      log("ws_auth_ok", { ip: ws.__ip, clientId, address });
      return;
    }

    if (msg.type === "join_queue") {
      const game = msg.game;
      const clientId = msg.clientId;
      const rawAddr = (msg.address || "").trim();
      if (!clientId || !/^0x[a-fA-F0-9]{40}$/.test(rawAddr)) {
        ws.send(JSON.stringify({ type: "error", message: "clientId and valid address required" }));
        return;
      }
      const address = rawAddr.toLowerCase();
      if (!CAPACITY[game]) {
        ws.send(JSON.stringify({ type: "error", message: "Unknown game" }));
        return;
      }

      if (!ws.__auth.ok || ws.__auth.address !== address || ws.__auth.clientId !== clientId) {
        ws.send(JSON.stringify({ type: "error", message: "Authenticate wallet first (auth_hello/auth_response)." }));
        return;
      }

      if (!checkRateLimit(ws.__ip, address)) {
        ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded (max 5 joins/min per IP/address)." }));
        return;
      }

      let mayorBidWei = null;
      if (game === "mayor_voting") {
        mayorBidWei = msg.mayorBidWei;
        if (!mayorBidWei || typeof mayorBidWei !== "string" || !/^\d+$/.test(mayorBidWei)) {
          ws.send(JSON.stringify({ type: "error", message: "mayorBidWei (wei string) required for mayor_voting" }));
          return;
        }
      }

      removeClientEverywhere(clientId);

      const dup = queues[game].some((e) => e.address === address);
      if (dup) {
        ws.send(JSON.stringify({ type: "error", message: "Address already in this lobby" }));
        return;
      }

      boundClientId = clientId;

      queues[game].push({
        clientId,
        ws,
        address,
        mayorBidWei,
        game,
      });

      ws.send(
        JSON.stringify({
          type: "queue_joined",
          game,
          position: queues[game].length,
          needed: CAPACITY[game],
        })
      );
      broadcastQueueStatus(game);
      tryMatch(game);
    }

    if (msg.type === "leave_queue") {
      const clientId = msg.clientId;
      if (!clientId) return;
      for (const g of Object.keys(queues)) {
        const before = queues[g].length;
        queues[g] = queues[g].filter((e) => e.clientId !== clientId);
        if (queues[g].length !== before) {
          broadcastQueueStatus(g);
        }
      }
      ws.send(JSON.stringify({ type: "queue_left" }));
    }
  });

  ws.on("close", () => {
    if (!boundClientId) return;
    for (const g of Object.keys(queues)) {
      const before = queues[g].length;
      queues[g] = queues[g].filter((e) => e.clientId !== boundClientId);
      if (queues[g].length !== before) {
        broadcastQueueStatus(g);
      }
    }
    log("ws_disconnected", { ip: ws.__ip, clientId: boundClientId || null });
  });
});

setInterval(() => {
  const now = nowMs();
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return;
    if (now - (ws.__lastSeenAt || 0) > HEARTBEAT_STALE_MS) {
      try {
        ws.send(JSON.stringify({ type: "error", message: "Disconnected: heartbeat timeout" }));
      } catch {
        /* ignore */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  });
  removeClosedSocketEntries();
}, HEARTBEAT_SWEEP_MS);

console.log(`BuzzCarnival lobby listening.`);
