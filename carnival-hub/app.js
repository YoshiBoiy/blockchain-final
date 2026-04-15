/* global ethers */
"use strict";

const CONTRACTS = {
  carnival: "0x912065165C9381732d694C9699e62B2bb02Fd999",
  buzz: "0x26b7bbf61eAf8Aa9b4b6919593A3272DadE22705",
  koth: "0xE92913e15BED6a5FC019d6EF258b2ECaB3B63845",
};

const ABIS = {
  carnival: [
    "function duel1v1() external",
    "function duel_highroller() external",
    "function mayor_voting(uint256 buzzAmount) external",
  ],
  buzz: [
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
  ],
  koth: [
    "function king() view returns (address)",
  ],
};

const state = {
  provider: null,
  signer: null,
  address: null,
  readOnly: false,
};

function getOrCreateLobbyClientId() {
  try {
    let id = localStorage.getItem("LOBBY_CLIENT_ID");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("LOBBY_CLIENT_ID", id);
    }
    return id;
  } catch {
    return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const lobbyState = {
  ws: null,
  clientId: getOrCreateLobbyClientId(),
  queueGame: null,
  authenticated: false,
  heartbeatTimer: null,
};

const el = {
  connectWalletBtn: document.getElementById("connectWalletBtn"),
  jumpConnectBtn: document.getElementById("jumpConnectBtn"),
  manualAddressInput: document.getElementById("manualAddressInput"),
  manualConnectBtn: document.getElementById("manualConnectBtn"),
  landingSection: document.getElementById("landingSection"),
  dashboardSection: document.getElementById("dashboardSection"),
  connectionLabel: document.getElementById("connectionLabel"),
  addressLabel: document.getElementById("addressLabel"),
  buzzBalanceLabel: document.getElementById("buzzBalanceLabel"),
  allowanceLabel: document.getElementById("allowanceLabel"),
  refreshBtn: document.getElementById("refreshBtn"),
  lobbyWsUrlPublic: document.getElementById("lobbyWsUrlPublic"),
  lobbyWsUrlPrivate: document.getElementById("lobbyWsUrlPrivate"),
  lobbyConnectBtn: document.getElementById("lobbyConnectBtn"),
  lobbyDisconnectBtn: document.getElementById("lobbyDisconnectBtn"),
  lobbyWsStatus: document.getElementById("lobbyWsStatus"),
  lobbyTargetPublic: document.getElementById("lobbyTargetPublic"),
  lobbyTargetPrivate: document.getElementById("lobbyTargetPrivate"),
  duelQueueStatus: document.getElementById("duelQueueStatus"),
  duelJoinQueueBtn: document.getElementById("duelJoinQueueBtn"),
  duelLeaveQueueBtn: document.getElementById("duelLeaveQueueBtn"),
  highrollerQueueStatus: document.getElementById("highrollerQueueStatus"),
  highrollerJoinQueueBtn: document.getElementById("highrollerJoinQueueBtn"),
  highrollerLeaveQueueBtn: document.getElementById("highrollerLeaveQueueBtn"),
  mayorQueueStatus: document.getElementById("mayorQueueStatus"),
  mayorJoinQueueBtn: document.getElementById("mayorJoinQueueBtn"),
  mayorLeaveQueueBtn: document.getElementById("mayorLeaveQueueBtn"),
  duelLobbyPanel: document.getElementById("duelLobbyPanel"),
  duelLobbyPanelText: document.getElementById("duelLobbyPanelText"),
  highrollerLobbyPanel: document.getElementById("highrollerLobbyPanel"),
  highrollerLobbyPanelText: document.getElementById("highrollerLobbyPanelText"),
  mayorLobbyPanel: document.getElementById("mayorLobbyPanel"),
  mayorLobbyPanelText: document.getElementById("mayorLobbyPanelText"),
  duelBtn: document.getElementById("duelBtn"),
  highrollerBtn: document.getElementById("highrollerBtn"),
  mayorAmountInput: document.getElementById("mayorAmountInput"),
  mayorBtn: document.getElementById("mayorBtn"),
  kingLabel: document.getElementById("kingLabel"),
  refreshKingBtn: document.getElementById("refreshKingBtn"),
  colludeInput: document.getElementById("colludeInput"),
  encodeBtn: document.getElementById("encodeBtn"),
  encodedOutput: document.getElementById("encodedOutput"),
  logOutput: document.getElementById("logOutput"),
};

function log(msg, isErr = false) {
  const p = document.createElement("p");
  p.className = `log-line${isErr ? " err" : ""}`;
  p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.logOutput.prepend(p);
}

function setDashboardVisible() {
  el.landingSection.classList.add("hidden");
  el.dashboardSection.classList.remove("hidden");
}

function setActionButtonsDisabled(disabled) {
  el.duelBtn.disabled = disabled;
  el.highrollerBtn.disabled = disabled;
  el.mayorBtn.disabled = disabled;
  if (disabled) {
    if (el.duelJoinQueueBtn) el.duelJoinQueueBtn.disabled = true;
    if (el.highrollerJoinQueueBtn) el.highrollerJoinQueueBtn.disabled = true;
    if (el.mayorJoinQueueBtn) el.mayorJoinQueueBtn.disabled = true;
    if (el.duelLeaveQueueBtn) el.duelLeaveQueueBtn.disabled = true;
    if (el.highrollerLeaveQueueBtn) el.highrollerLeaveQueueBtn.disabled = true;
    if (el.mayorLeaveQueueBtn) el.mayorLeaveQueueBtn.disabled = true;
  } else {
    updateLobbyControls();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLobbyWsUrl() {
  return "wss://buzz-carnival.centralus.cloudapp.azure.com/ws/";
}

/** Shown in the UI; full URL is still `defaultLobbyWsUrl()` for connections. */
function publicLobbyUrlDisplay() {
  return "wss://buzz-carnival";
}

const LOBBY_TARGET_KEY = "LOBBY_TARGET";

function getLobbyTarget() {
  if (el.lobbyTargetPrivate && el.lobbyTargetPrivate.checked) return "private";
  return "public";
}

function setLobbyTargetRadio(value) {
  if (value === "private" && el.lobbyTargetPrivate) {
    el.lobbyTargetPrivate.checked = true;
  } else if (el.lobbyTargetPublic) {
    el.lobbyTargetPublic.checked = true;
  }
}

function persistLobbyTarget() {
  try {
    localStorage.setItem(LOBBY_TARGET_KEY, getLobbyTarget());
  } catch {
    /* ignore */
  }
}

function loadLobbyWsUrlField() {
  try {
    if (el.lobbyWsUrlPublic) {
      el.lobbyWsUrlPublic.value = publicLobbyUrlDisplay();
    }
    const savedPrivate = localStorage.getItem("LOBBY_WS_URL_PRIVATE");
    if (savedPrivate && el.lobbyWsUrlPrivate) {
      el.lobbyWsUrlPrivate.value = savedPrivate;
    }
    const legacy = localStorage.getItem("LOBBY_WS_URL");
    if (legacy && el.lobbyWsUrlPrivate && !el.lobbyWsUrlPrivate.value.trim()) {
      const pub = defaultLobbyWsUrl();
      if (legacy.trim() && legacy.trim() !== pub) {
        el.lobbyWsUrlPrivate.value = legacy.trim();
      }
    }
    const savedTarget = localStorage.getItem(LOBBY_TARGET_KEY);
    if (savedTarget === "private" || savedTarget === "public") {
      setLobbyTargetRadio(savedTarget);
    } else if (el.lobbyWsUrlPrivate && el.lobbyWsUrlPrivate.value.trim()) {
      setLobbyTargetRadio("private");
    } else {
      setLobbyTargetRadio("public");
    }
    updateLobbyModeIndicator();
  } catch {
    /* ignore */
  }
}

function persistLobbyWsUrl() {
  try {
    if (el.lobbyWsUrlPrivate) {
      localStorage.setItem("LOBBY_WS_URL_PRIVATE", el.lobbyWsUrlPrivate.value.trim());
    }
  } catch {
    /* ignore */
  }
}

function lobbyWsUrlResolved() {
  if (getLobbyTarget() === "public") {
    return defaultLobbyWsUrl();
  }
  return (el.lobbyWsUrlPrivate && el.lobbyWsUrlPrivate.value.trim()) || "";
}

function usesPrivateLobby() {
  return getLobbyTarget() === "private";
}

function updateLobbyModeIndicator() {
  const priv = getLobbyTarget() === "private";
  if (el.lobbyWsUrlPublic) {
    el.lobbyWsUrlPublic.classList.toggle("lobby-input--active", !priv);
  }
  if (el.lobbyWsUrlPrivate) {
    el.lobbyWsUrlPrivate.classList.toggle("lobby-input--active", priv);
  }
}

function setLobbyConnectionUi(connected) {
  const modeShort = usesPrivateLobby() ? "PRIVATE" : "PUBLIC";
  if (el.lobbyWsStatus) {
    if (!connected) {
      el.lobbyWsStatus.textContent = `disconnected · next: ${modeShort}`;
    } else {
      el.lobbyWsStatus.textContent = lobbyState.authenticated
        ? `connected + authenticated · ${modeShort} lobby`
        : `connected (auth pending) · ${modeShort} lobby`;
    }
  }
  if (el.lobbyConnectBtn) el.lobbyConnectBtn.disabled = connected;
  if (el.lobbyDisconnectBtn) el.lobbyDisconnectBtn.disabled = !connected;
  updateLobbyControls();
}

function joinQueueBlockedHint() {
  const walletOk = Boolean(state.signer && !state.readOnly && state.address);
  const wsOk = lobbyState.ws && lobbyState.ws.readyState === WebSocket.OPEN;
  if (!walletOk) return "Connect wallet (signing) first.";
  if (!wsOk) return 'Click [ CONNECT ] under Lobby server and wait for “connected”.';
  if (!lobbyState.authenticated) return "Approve the lobby signature in your wallet, then wait for “authenticated”.";
  return "";
}

function syncLobbySessionPanels() {
  const g = lobbyState.queueGame;
  const bind = (panel, textEl, lineEl, gameKey) => {
    if (!panel || !textEl) return;
    const on = g === gameKey;
    panel.classList.toggle("hidden", !on);
    panel.setAttribute("aria-hidden", String(!on));
    if (on) {
      textEl.textContent = (lineEl && lineEl.textContent) || "Waiting…";
    }
  };
  bind(el.duelLobbyPanel, el.duelLobbyPanelText, el.duelQueueStatus, "duel1v1");
  bind(el.highrollerLobbyPanel, el.highrollerLobbyPanelText, el.highrollerQueueStatus, "duel_highroller");
  bind(el.mayorLobbyPanel, el.mayorLobbyPanelText, el.mayorQueueStatus, "mayor_voting");
}

function updateLobbyControls() {
  const walletOk = Boolean(state.signer && !state.readOnly && state.address);
  const wsOk = lobbyState.ws && lobbyState.ws.readyState === WebSocket.OPEN;
  const canQueue = walletOk && wsOk && lobbyState.authenticated;
  const hint = joinQueueBlockedHint();

  if (el.duelJoinQueueBtn) {
    el.duelJoinQueueBtn.disabled = !canQueue;
    el.duelJoinQueueBtn.title = canQueue ? "" : hint;
  }
  if (el.highrollerJoinQueueBtn) {
    el.highrollerJoinQueueBtn.disabled = !canQueue;
    el.highrollerJoinQueueBtn.title = canQueue ? "" : hint;
  }
  if (el.mayorJoinQueueBtn) {
    el.mayorJoinQueueBtn.disabled = !canQueue;
    el.mayorJoinQueueBtn.title = canQueue ? "" : hint;
  }

  const inDuel = lobbyState.queueGame === "duel1v1";
  const inHigh = lobbyState.queueGame === "duel_highroller";
  const inMayor = lobbyState.queueGame === "mayor_voting";

  if (el.duelLeaveQueueBtn) el.duelLeaveQueueBtn.disabled = !wsOk || !inDuel;
  if (el.highrollerLeaveQueueBtn) el.highrollerLeaveQueueBtn.disabled = !wsOk || !inHigh;
  if (el.mayorLeaveQueueBtn) el.mayorLeaveQueueBtn.disabled = !wsOk || !inMayor;

  syncLobbySessionPanels();
}

function clearLobbyHeartbeat() {
  if (lobbyState.heartbeatTimer) {
    clearInterval(lobbyState.heartbeatTimer);
    lobbyState.heartbeatTimer = null;
  }
}

function startLobbyHeartbeat() {
  clearLobbyHeartbeat();
  lobbyState.heartbeatTimer = setInterval(() => {
    if (!lobbyState.ws || lobbyState.ws.readyState !== WebSocket.OPEN) return;
    lobbyState.ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
  }, 15000);
}

async function sendLobbyAuthHello() {
  if (!lobbyState.ws || lobbyState.ws.readyState !== WebSocket.OPEN) return;
  if (!state.signer || state.readOnly || !state.address) {
    lobbyState.authenticated = false;
    setLobbyConnectionUi(true);
    updateLobbyControls();
    return;
  }
  lobbyState.ws.send(
    JSON.stringify({
      type: "auth_hello",
      clientId: lobbyState.clientId,
      address: state.address,
    })
  );
}

function resetQueueStatusTexts() {
  if (el.duelQueueStatus) {
    el.duelQueueStatus.textContent =
      "Join the lobby queue; entry BUZZ is sent only when the match starts.";
  }
  if (el.highrollerQueueStatus) {
    el.highrollerQueueStatus.textContent =
      "Join the lobby queue; entry BUZZ is sent only when the match starts.";
  }
  if (el.mayorQueueStatus) {
    el.mayorQueueStatus.textContent =
      "Join with your bid locked for this round; BUZZ is sent only when 5 players are matched.";
  }
}

function applyQueueStatus(msg) {
  const { game, count, needed } = msg;
  const line = `In queue: ${count} / ${needed} players (waiting to start)`;
  if (game === "duel1v1" && el.duelQueueStatus) el.duelQueueStatus.textContent = line;
  if (game === "duel_highroller" && el.highrollerQueueStatus) el.highrollerQueueStatus.textContent = line;
  if (game === "mayor_voting" && el.mayorQueueStatus) el.mayorQueueStatus.textContent = line;
}

function lobbyWsCloseDescription(ev) {
  const code = ev.code;
  const reason = (ev.reason && String(ev.reason).trim()) || "";
  const known = {
    1000: "normal close",
    1001: "going away",
    1002: "protocol error",
    1003: "unsupported data",
    1006: "abnormal (no close frame — often network drop, proxy, or host closed without handshake)",
    1008: "policy violation",
    1011: "server error",
    1012: "service restart",
    1015: "TLS handshake failed",
  };
  const label = known[code] || `code ${code}`;
  const extra = reason ? ` — ${reason}` : "";
  return `${label}${extra}`;
}

function lobbyWsErrorLogHint(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname || "";
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      return "Lobby WebSocket error — start the lobby in carnival-hub: npm run lobby";
    }
    if (host.includes("cloudapp.azure.com") || host.includes("buzz-carnival")) {
      return "Lobby WebSocket error — could not complete socket to public host (firewall/VPN, outage, or TLS). Retry [ CONNECT ] or use a private lobby URL you control.";
    }
    return `Lobby WebSocket error — check WSS URL and that ${host} allows WebSockets.`;
  } catch {
    return "Lobby WebSocket error — connection failed.";
  }
}

function connectLobbyWs() {
  if (lobbyState.ws && lobbyState.ws.readyState === WebSocket.OPEN) {
    log("Already connected to the lobby.");
    return;
  }
  persistLobbyWsUrl();
  persistLobbyTarget();
  const url = lobbyWsUrlResolved();
  if (!url) {
    log("Private lobby is selected but the WSS URL is empty. Enter a URL or switch to public lobby.", true);
    return;
  }
  if (lobbyState.ws) {
    try {
      lobbyState.ws.close();
    } catch {
      /* ignore */
    }
    lobbyState.ws = null;
  }

  log("Connecting to lobby…");
  let ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    log(`Lobby connect failed: ${e.message}`, true);
    return;
  }
  lobbyState.ws = ws;

  ws.onopen = () => {
    if (lobbyState.ws !== ws) return;
    lobbyState.authenticated = false;
    setLobbyConnectionUi(true);
    startLobbyHeartbeat();
    log(`Lobby server connected (${url}).`);
    void sendLobbyAuthHello();
  };

  ws.onclose = (ev) => {
    if (lobbyState.ws !== ws) return;
    lobbyState.ws = null;
    lobbyState.queueGame = null;
    lobbyState.authenticated = false;
    clearLobbyHeartbeat();
    setLobbyConnectionUi(false);
    resetQueueStatusTexts();
    log(`Lobby disconnected (${lobbyWsCloseDescription(ev)}).`);
  };

  ws.onerror = () => {
    if (lobbyState.ws !== ws) return;
    log(lobbyWsErrorLogHint(url), true);
  };

  ws.onmessage = (ev) => {
    if (lobbyState.ws !== ws) return;
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "queue_status") {
      applyQueueStatus(msg);
      return;
    }
    if (msg.type === "auth_challenge") {
      if (!state.signer || state.readOnly || !state.address) {
        log("Lobby requested auth, but wallet is not in signing mode.", true);
        return;
      }
      Promise.resolve()
        .then(async () => {
          const signature = await state.signer.signMessage(msg.message);
          if (lobbyState.ws !== ws || lobbyState.ws.readyState !== WebSocket.OPEN) return;
          lobbyState.ws.send(
            JSON.stringify({
              type: "auth_response",
              clientId: msg.clientId,
              address: msg.address,
              signature,
            })
          );
        })
        .catch((e) => {
          log(`Lobby auth signature failed: ${e.message}`, true);
        });
      return;
    }
    if (msg.type === "auth_ok") {
      lobbyState.authenticated = true;
      setLobbyConnectionUi(true);
      updateLobbyControls();
      log(`Lobby auth OK for ${msg.address}`);
      return;
    }
    if (msg.type === "auth_error") {
      lobbyState.authenticated = false;
      setLobbyConnectionUi(true);
      updateLobbyControls();
      log(`Lobby auth failed: ${msg.message}`, true);
      return;
    }
    if (msg.type === "pong") {
      return;
    }
    if (msg.type === "queue_joined") {
      lobbyState.queueGame = msg.game;
      const line = `In queue: ${msg.position} / ${msg.needed} players — waiting for more players…`;
      if (msg.game === "duel1v1" && el.duelQueueStatus) el.duelQueueStatus.textContent = line;
      if (msg.game === "duel_highroller" && el.highrollerQueueStatus) el.highrollerQueueStatus.textContent = line;
      if (msg.game === "mayor_voting" && el.mayorQueueStatus) el.mayorQueueStatus.textContent = line;
      updateLobbyControls();
      log(`Joined ${msg.game} lobby (${msg.position}/${msg.needed}).`);
      return;
    }
    if (msg.type === "queue_left") {
      lobbyState.queueGame = null;
      resetQueueStatusTexts();
      updateLobbyControls();
      log("Left lobby queue.");
      return;
    }
    if (msg.type === "match_ready") {
      void handleMatchReady(msg);
      return;
    }
    if (msg.type === "error") {
      log(`Lobby: ${msg.message}`, true);
    }
  };
}

function disconnectLobbyWs() {
  const prev = lobbyState.ws;
  lobbyState.ws = null;
  if (prev) {
    try {
      prev.close();
    } catch {
      /* ignore */
    }
  }
  lobbyState.queueGame = null;
  lobbyState.authenticated = false;
  clearLobbyHeartbeat();
  setLobbyConnectionUi(false);
  resetQueueStatusTexts();
  log("Lobby disconnected (by you).");
}

function sendJoinQueue(game) {
  if (!state.signer || state.readOnly || !state.address) {
    log("Connect wallet first.", true);
    return;
  }
  if (!lobbyState.ws || lobbyState.ws.readyState !== WebSocket.OPEN) {
    log("Connect to lobby server first.", true);
    return;
  }
  if (!lobbyState.authenticated) {
    log(
      "Lobby has not authenticated your wallet yet. Approve the signature request, then wait for “connected + authenticated” under the lobby status.",
      true
    );
    return;
  }
  const payload = {
    type: "join_queue",
    game,
    clientId: lobbyState.clientId,
    address: ethers.getAddress(state.address),
  };
  if (game === "mayor_voting") {
    const amount = Number(el.mayorAmountInput && el.mayorAmountInput.value ? el.mayorAmountInput.value : "0");
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      log("Mayor lobby: set a whole BUZZ bid from 1 to 100 first.", true);
      return;
    }
    payload.mayorBidWei = ethers.parseEther(String(amount)).toString();
  }
  log(`Sending join_queue for ${game}…`);
  lobbyState.ws.send(JSON.stringify(payload));
}

function sendLeaveQueue() {
  if (!lobbyState.ws || lobbyState.ws.readyState !== WebSocket.OPEN) return;
  lobbyState.ws.send(JSON.stringify({ type: "leave_queue", clientId: lobbyState.clientId }));
}

const DUEL_STAGGER_MS = 4500;
const MAYOR_STAGGER_MS = 2500;

async function handleMatchReady(msg) {
  const { game, yourIndex, players, matchId } = msg;
  lobbyState.queueGame = null;
  updateLobbyControls();
  log(`Match ready [${matchId}] — seat ${yourIndex + 1}/${players.length} (${game}). Executing on-chain…`);

  try {
    if (game === "duel1v1") {
      const delayMs = yourIndex * DUEL_STAGGER_MS;
      if (delayMs > 0) {
        log(`Waiting ${delayMs / 1000}s so player 1's tx can confirm first…`);
        await sleep(delayMs);
      }
      await submitTx("duel1v1");
    } else if (game === "duel_highroller") {
      const delayMs = yourIndex * DUEL_STAGGER_MS;
      if (delayMs > 0) {
        log(`Waiting ${delayMs / 1000}s so player 1's tx can confirm first…`);
        await sleep(delayMs);
      }
      await submitTx("duel_highroller");
    } else if (game === "mayor_voting") {
      const delayMs = yourIndex * MAYOR_STAGGER_MS;
      if (delayMs > 0) {
        log(`Waiting ${delayMs / 1000}s (spacing mayor txs)…`);
        await sleep(delayMs);
      }
      const bid = players[yourIndex] && players[yourIndex].mayorBidWei;
      if (!bid) {
        log("Match payload missing mayorBidWei.", true);
        return;
      }
      await submitTx("mayor_voting", [BigInt(bid)]);
    }
  } catch (e) {
    log(`Match execution failed: ${e.message}`, true);
  }
}

async function resolveInputAddress(raw) {
  if (!raw) throw new Error("Enter address or ENS name.");
  if (raw.endsWith(".eth")) {
    const provider = new ethers.JsonRpcProvider("https://rpc.sepolia.org");
    const resolved = await provider.resolveName(raw);
    if (!resolved) throw new Error("Could not resolve ENS name.");
    return resolved;
  }
  return ethers.getAddress(raw);
}

async function refreshAccountData() {
  if (!state.address) return;
  const provider = state.provider || new ethers.JsonRpcProvider("https://rpc.sepolia.org");
  const buzz = new ethers.Contract(CONTRACTS.buzz, ABIS.buzz, provider);
  const [rawBal, rawAllow] = await Promise.all([
    buzz.balanceOf(state.address),
    buzz.allowance(state.address, CONTRACTS.carnival),
  ]);
  el.buzzBalanceLabel.textContent = `BUZZ balance: ${ethers.formatEther(rawBal)}`;
  el.allowanceLabel.textContent = `carnival allowance: ${ethers.formatEther(rawAllow)} BUZZ`;
}

function setConnectedState(label) {
  el.connectionLabel.textContent = `wallet: ${label}`;
  el.addressLabel.textContent = `address: ${state.address || "n/a"}`;
  setDashboardVisible();
}

async function connectWallet() {
  if (!window.ethereum) {
    log("No injected wallet found. Install MetaMask.", true);
    return;
  }
  try {
    state.provider = new ethers.BrowserProvider(window.ethereum);
    await state.provider.send("eth_requestAccounts", []);
    state.signer = await state.provider.getSigner();
    state.address = await state.signer.getAddress();
    state.readOnly = false;
    setConnectedState("connected (signing enabled)");
    setActionButtonsDisabled(false);
    await refreshAccountData();
    log(`Wallet connected: ${state.address}`);
    if (lobbyState.ws && lobbyState.ws.readyState === WebSocket.OPEN) {
      void sendLobbyAuthHello();
    }
  } catch (err) {
    log(`Wallet connect failed: ${err.message}`, true);
  }
}

async function connectManual() {
  try {
    const addr = await resolveInputAddress(el.manualAddressInput.value.trim());
    state.address = addr;
    state.provider = new ethers.JsonRpcProvider("https://rpc.sepolia.org");
    state.signer = null;
    state.readOnly = true;
    setConnectedState("read-only (manual address)");
    setActionButtonsDisabled(true);
    await refreshAccountData();
    log(`Read-only connected: ${addr}`);
    lobbyState.authenticated = false;
    if (lobbyState.ws && lobbyState.ws.readyState === WebSocket.OPEN) {
      setLobbyConnectionUi(true);
      updateLobbyControls();
    }
  } catch (err) {
    log(`Manual connect failed: ${err.message}`, true);
  }
}

const LEADERBOARD_URL = "https://buzz-leaderboard-gt.vercel.app/";

const SEPOLIA_RPC_FALLBACKS = [
  "https://rpc.sepolia.org",
  "https://ethereum-sepolia.publicnode.com",
  "https://sepolia.drpc.org",
];

/**
 * Leaderboard always lists the king in the table with a 👑 badge on that row,
 * even when the KOTH collapsible is collapsed (no .koth-king-addr in HTML).
 */
function parseKingFromKingBadge(doc) {
  const tds = doc.querySelectorAll("td.address");
  for (const td of tds) {
    if (!td.querySelector(".king-badge")) continue;
    const a = td.querySelector('a[href*="sepolia.etherscan.io/address/"]');
    if (!a) continue;
    const text = (a.textContent || "").trim();
    const href = (a.getAttribute("href") || "").trim();
    if (text && href && /^0x[a-fA-F0-9]{40}$/.test(text)) {
      return { address: ethers.getAddress(text), href };
    }
  }
  return null;
}

/**
 * Raw HTML fallback: last sepolia address link before "king-badge" in source order.
 */
function parseKingFromKingBadgeHtmlString(html) {
  const idx = html.indexOf("king-badge");
  if (idx === -1) return null;
  const before = html.slice(0, idx);
  const re = /href="(https:\/\/sepolia\.etherscan\.io\/address\/(0x[a-fA-F0-9]{40}))"/gi;
  let last = null;
  let m;
  while ((m = re.exec(before)) !== null) {
    last = { href: m[1], raw: m[2] };
  }
  if (!last) return null;
  return { address: ethers.getAddress(last.raw), href: last.href };
}

/**
 * Cross-origin iframes cannot be scripted from the parent; this only succeeds if
 * the leaderboard is same-origin (e.g. embedded). Otherwise resolves null.
 */
function tryExpandFirstCollapsibleAndReadKing() {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "leaderboard-koth-expand");
    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none";
    iframe.src = LEADERBOARD_URL;

    const done = (value) => {
      try {
        iframe.remove();
      } catch (_) {
        /* ignore */
      }
      resolve(value);
    };

    const t = window.setTimeout(() => done(null), 12000);

    iframe.onload = () => {
      try {
        const idoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!idoc) {
          window.clearTimeout(t);
          done(null);
          return;
        }
        const sections = idoc.querySelectorAll(".collapsible-section");
        const first = sections[0];
        const toggle = first?.querySelector(".collapsible-toggle");
        toggle?.click();
        window.setTimeout(() => {
          try {
            const link = idoc.querySelector(".koth-king-addr a");
            const text = (link?.textContent || "").trim();
            const href = (link?.getAttribute("href") || "").trim();
            if (link && text && href && /^0x[a-fA-F0-9]{40}$/.test(text)) {
              window.clearTimeout(t);
              done({ address: ethers.getAddress(text), href });
            } else {
              window.clearTimeout(t);
              done(null);
            }
          } catch (_) {
            window.clearTimeout(t);
            done(null);
          }
        }, 600);
      } catch (_) {
        window.clearTimeout(t);
        done(null);
      }
    };

    iframe.onerror = () => {
      window.clearTimeout(t);
      done(null);
    };

    document.body.appendChild(iframe);
  });
}

async function fetchKingFromChain() {
  let lastErr;
  for (const rpc of SEPOLIA_RPC_FALLBACKS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const koth = new ethers.Contract(CONTRACTS.koth, ABIS.koth, provider);
      const chainKing = await koth.king();
      if (chainKing && chainKing !== ethers.ZeroAddress) {
        const normalized = ethers.getAddress(chainKing);
        return {
          address: normalized,
          href: `https://sepolia.etherscan.io/address/${normalized}`,
          source: "chain",
        };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("RPC king() failed on all endpoints.");
}

async function submitTx(fnName, args = []) {
  if (!state.signer || state.readOnly) {
    log("Transaction requires wallet connect mode.", true);
    return false;
  }
  try {
    const carnival = new ethers.Contract(CONTRACTS.carnival, ABIS.carnival, state.signer);
    log(`Submitting ${fnName}...`);
    const tx = await carnival[fnName](...args);
    log(`Tx submitted: ${tx.hash}`);
    await tx.wait(1);
    log(`${fnName} confirmed.`);
    await refreshAccountData();
    return true;
  } catch (err) {
    log(`${fnName} failed: ${err.shortMessage || err.message}`, true);
    return false;
  }
}

async function fetchKingAddress() {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(LEADERBOARD_URL)}`;
  let html = "";

  try {
    const resp = await fetch(LEADERBOARD_URL);
    if (resp.ok) html = await resp.text();
  } catch (_) {
    // Direct CORS might fail; use fallback proxy.
  }

  if (!html) {
    const resp = await fetch(proxyUrl);
    if (!resp.ok) throw new Error("Could not fetch leaderboard page.");
    html = await resp.text();
  }

  const doc = new DOMParser().parseFromString(html, "text/html");

  const fromBadge = parseKingFromKingBadge(doc);
  if (fromBadge) {
    return { ...fromBadge, source: "leaderboard-king-badge" };
  }

  const fromBadgeStr = parseKingFromKingBadgeHtmlString(html);
  if (fromBadgeStr) {
    return { ...fromBadgeStr, source: "leaderboard-king-badge-html" };
  }

  // Expanded KOTH panel: .koth-king-addr (only present when section is open in HTML).
  let kingLink = doc.querySelector(".koth-king-addr a");
  if (!kingLink) {
    const sections = Array.from(doc.querySelectorAll(".collapsible-section"));
    const kothSection = sections.find((section) => {
      const toggle = section.querySelector(".collapsible-toggle");
      return toggle && /King of the Hill/i.test(toggle.textContent || "");
    });
    if (kothSection) {
      kingLink = kothSection.querySelector(".koth-king-addr a");
    }
  }

  if (kingLink) {
    const address = (kingLink.textContent || "").trim();
    const href = (kingLink.getAttribute("href") || "").trim();
    if (address && href) {
      return { address: ethers.getAddress(address), href, source: "leaderboard-koth-panel" };
    }
  }

  const scopedMatch = html.match(
    /koth-king-addr[\s\S]{0,1500}?href="([^"]*sepolia\.etherscan\.io\/address\/0x[a-fA-F0-9]{40})"[\s\S]{0,250}>(0x[a-fA-F0-9]{40})<\/a>/i
  );
  if (scopedMatch) {
    return {
      href: scopedMatch[1],
      address: ethers.getAddress(scopedMatch[2]),
      source: "leaderboard-regex",
    };
  }

  const stateAddressMatch = html.match(/"currentKing"\s*:\s*"(0x[a-fA-F0-9]{40})"/i);
  if (stateAddressMatch) {
    const fallbackAddress = ethers.getAddress(stateAddressMatch[1]);
    return {
      address: fallbackAddress,
      href: `https://sepolia.etherscan.io/address/${fallbackAddress}`,
      source: "leaderboard-json",
    };
  }

  const iframeKing = await tryExpandFirstCollapsibleAndReadKing();
  if (iframeKing) {
    return { ...iframeKing, source: "leaderboard-iframe-expand" };
  }

  return fetchKingFromChain();
}

async function refreshKing() {
  try {
    el.kingLabel.textContent = "loading...";
    el.kingLabel.setAttribute("href", "#");
    const king = await fetchKingAddress();
    el.kingLabel.textContent = king.address;
    el.kingLabel.setAttribute("href", king.href);
    const src = king.source ? ` (${king.source})` : "";
    log(`King updated${src}: ${king.address}`);
  } catch (err) {
    el.kingLabel.textContent = "unavailable";
    el.kingLabel.setAttribute("href", "#");
    log(`King fetch failed: ${err.message}`, true);
  }
}

function encodeCollusionMessage(input) {
  const raw = input.trim();
  if (!raw) return "";
  return btoa(unescape(encodeURIComponent(raw)));
}

el.connectWalletBtn.addEventListener("click", connectWallet);
if (el.jumpConnectBtn) {
  el.jumpConnectBtn.addEventListener("click", connectWallet);
}
el.manualConnectBtn.addEventListener("click", connectManual);
el.refreshBtn.addEventListener("click", refreshAccountData);

if (el.lobbyConnectBtn) {
  el.lobbyConnectBtn.addEventListener("click", connectLobbyWs);
}
if (el.lobbyDisconnectBtn) {
  el.lobbyDisconnectBtn.addEventListener("click", disconnectLobbyWs);
}

if (el.duelJoinQueueBtn) {
  el.duelJoinQueueBtn.addEventListener("click", () => sendJoinQueue("duel1v1"));
}
if (el.duelLeaveQueueBtn) {
  el.duelLeaveQueueBtn.addEventListener("click", sendLeaveQueue);
}
if (el.highrollerJoinQueueBtn) {
  el.highrollerJoinQueueBtn.addEventListener("click", () => sendJoinQueue("duel_highroller"));
}
if (el.highrollerLeaveQueueBtn) {
  el.highrollerLeaveQueueBtn.addEventListener("click", sendLeaveQueue);
}
if (el.mayorJoinQueueBtn) {
  el.mayorJoinQueueBtn.addEventListener("click", () => sendJoinQueue("mayor_voting"));
}
if (el.mayorLeaveQueueBtn) {
  el.mayorLeaveQueueBtn.addEventListener("click", sendLeaveQueue);
}

el.duelBtn.addEventListener("click", () => submitTx("duel1v1"));
el.highrollerBtn.addEventListener("click", () => submitTx("duel_highroller"));
el.mayorBtn.addEventListener("click", () => {
  const amount = Number(el.mayorAmountInput.value || "0");
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    log("Mayor voting amount must be an integer from 1 to 100 BUZZ.", true);
    return;
  }
  submitTx("mayor_voting", [ethers.parseEther(String(amount))]);
});
el.refreshKingBtn.addEventListener("click", refreshKing);
el.encodeBtn.addEventListener("click", () => {
  el.encodedOutput.value = encodeCollusionMessage(el.colludeInput.value);
  log("Collusion message encoded.");
});

loadLobbyWsUrlField();
function onLobbyTargetChange() {
  persistLobbyTarget();
  updateLobbyModeIndicator();
  setLobbyConnectionUi(Boolean(lobbyState.ws && lobbyState.ws.readyState === WebSocket.OPEN));
}
if (el.lobbyTargetPublic) {
  el.lobbyTargetPublic.addEventListener("change", onLobbyTargetChange);
}
if (el.lobbyTargetPrivate) {
  el.lobbyTargetPrivate.addEventListener("change", onLobbyTargetChange);
}
if (el.lobbyWsUrlPrivate) {
  el.lobbyWsUrlPrivate.addEventListener("input", () => {
    persistLobbyWsUrl();
    setLobbyConnectionUi(Boolean(lobbyState.ws && lobbyState.ws.readyState === WebSocket.OPEN));
  });
}
setActionButtonsDisabled(true);
setLobbyConnectionUi(false);
refreshKing();
