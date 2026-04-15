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

- **Public lobby** (readonly in UI): `wss://buzz-carnival.centralus.cloudapp.azure.com/ws/` — class-wide, first-come first-served queue.
- **Private lobby** (optional): paste your own `wss://...` URL if you run a separate lobby for a collusion group; when set, connect uses that URL instead of public.

For pages served over **HTTPS**, use **WSS** URLs. Private URL is persisted as `LOBBY_WS_URL_PRIVATE` in localStorage.

## Notes

- Use Sepolia in your wallet.
- You must approve BUZZ spending for the carnival contract before game actions.
- If direct leaderboard fetch is blocked by CORS, app uses `allorigins` fallback.
- On-chain carnival rules are unchanged: duels use one global queue per mode; mayor rounds need five distinct players in one round. The lobby only coordinates who sends transactions and when.
