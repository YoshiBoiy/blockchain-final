# Carnival Hub

Terminal-style web app for BuzzCarnival game operations.

## Features

- Wallet connect (MetaMask/injected provider) for on-chain actions
- Manual address or ENS connect mode for read-only dashboard
- **Lobby server (optional):** queue for duel 1v1 (2 players), duel highroller (2), and mayor voting (5). Entry BUZZ is sent only after the lobby fills and each client runs its staggered transaction.
- Solo “run tx now” shortcuts (same as calling the contract directly; duels still need a global second player on-chain)
- King of the Hill panel (leaderboard + on-chain `king()` fallback)
- Secret collusion message encoder (base64 utility)

## Run static hub

From repo root:

```bash
cd carnival-hub
python3 -m http.server 4173
```

Then open:

`http://localhost:4173`

## Run lobby server (matchmaking)

In a second terminal:

```bash
cd carnival-hub
npm install
npm run lobby
```

Default WebSocket URL: `ws://127.0.0.1:8787` (override with `LOBBY_WS_URL` in the UI). For a page served over **HTTPS**, the browser requires **WSS** to a reachable host (deploy the lobby behind TLS or use a tunnel).

## Notes

- Use Sepolia in your wallet.
- You must approve BUZZ spending for the carnival contract before game actions.
- If direct leaderboard fetch is blocked by CORS, app uses `allorigins` fallback.
- On-chain carnival rules are unchanged: duels use one global queue per mode; mayor rounds need five distinct players in one round. The lobby only coordinates who sends transactions and when.
