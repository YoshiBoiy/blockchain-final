"use strict";

/**
 * In-memory matchmaking for BuzzCarnival hub: duel 1v1 (2), highroller (2), mayor (5).
 * Run: npm install && npm run lobby
 */

const { WebSocketServer } = require("ws");

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

function removeClientEverywhere(clientId) {
  for (const game of Object.keys(queues)) {
    queues[game] = queues[game].filter((e) => e.clientId !== clientId);
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

wss.on("connection", (ws) => {
  let boundClientId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
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
  });
});

console.log(`BuzzCarnival lobby listening on ws://127.0.0.1:${PORT}`);
