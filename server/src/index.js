require("dotenv").config();

const path = require("node:path");
const http = require("node:http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const bcrypt = require("bcryptjs");

const {
  getAllCategories,
  publicLobbySummary,
  publicLobbyState,
  ensureHostValid,
  createLobby,
  addOrUpdatePlayer,
  removePlayer,
  safeMessage,
  startGameRound,
  computeVoteState,
  resolveVoting,
  applyScoringAfterVote,
  applyFraudGuess,
  getLeaderboard,
  defaultSettings
} = require("./state");

const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || "development";

const app = express();
app.use(express.json());

// In production, everything is same-origin. In dev, Vite runs separately.
app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, name: "the-fraud", ts: Date.now() });
});

app.get("/api/meta", (_req, res) => {
  res.json({ ok: true, categories: getAllCategories(), defaults: defaultSettings() });
});

const fs = require("node:fs");
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("*", (_req, res) => {
  const indexPath = path.join(publicDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send("Client not built yet. Run `npm run build` from repo root.");
  }
  return res.sendFile(indexPath);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

/** @type {Map<string, any>} */
const lobbies = new Map(); // lobbyId -> lobby
/** @type {Map<string, { lobbyId: string, playerId: string }>} */
const socketIndex = new Map(); // socketId -> membership

function listLobbies() {
  return [...lobbies.values()].map(publicLobbySummary).sort((a, b) => a.lobbyName.localeCompare(b.lobbyName));
}

function emitLobbyList(target) {
  const payload = { lobbies: listLobbies() };
  if (target) target.emit("LOBBY_LIST", payload);
  else io.emit("LOBBY_LIST", payload);
}

function emitLobbyState(lobby) {
  io.to(lobby.lobbyId).emit("LOBBY_STATE", publicLobbyState(lobby));
}

function emitHostChanged(lobby) {
  io.to(lobby.lobbyId).emit("HOST_CHANGED", { lobbyId: lobby.lobbyId, hostPlayerId: lobby.hostPlayerId });
}

function emitError(socket, code, message) {
  socket.emit("ERROR", { code, message });
}

function getMembership(socket) {
  return socketIndex.get(socket.id) || null;
}

function requireMembership(socket) {
  const m = getMembership(socket);
  if (!m) {
    emitError(socket, "NOT_IN_LOBBY", "You are not in a lobby.");
    return null;
  }
  const lobby = lobbies.get(m.lobbyId);
  if (!lobby) {
    socketIndex.delete(socket.id);
    emitError(socket, "LOBBY_NOT_FOUND", "Lobby not found.");
    return null;
  }
  return { lobby, membership: m };
}

function isHost(lobby, playerId) {
  return lobby.hostPlayerId && lobby.hostPlayerId === playerId;
}

function endRoundToLobby(lobby, reason, nextRoundInfo) {
  // Check if someone won (10 points)
  const leaderboard = getLeaderboard(lobby);
  const winner = leaderboard.find((p) => p.points >= 10);
  
  if (winner) {
    // Game over - someone reached 10 points
    lobby.gameState = {
      phase: "lobby",
      roundId: null,
      categoryId: null,
      categoryName: null,
      clueBoard16: null,
      secretIndex: null,
      fraudIds: [],
      votesByVoterId: {},
      voteToStartVoterIds: new Set(),
      lastVoteResult: { reason: "game_won", winner: { playerId: winner.playerId, name: winner.name, points: winner.points } }
    };
    emitLobbyState(lobby);
    io.to(lobby.lobbyId).emit("ROUND_ENDED", { lobbyId: lobby.lobbyId, nextRoundInfo: { gameWon: true, winner } });
    io.to(lobby.lobbyId).emit("SCORE_UPDATE", { lobbyId: lobby.lobbyId, leaderboard: getLeaderboard(lobby) });
    return;
  }
  
  // Continue automatically - start new round
  const gs = startGameRound(lobby);
  
  // Broadcast per-player GAME_STARTED without leaking secret to frauds
  for (const p of lobby.players) {
    if (!p.connected || !p.socketId) continue;
    const isFraud = (gs.fraudIds || []).includes(p.id);
    io.to(p.socketId).emit("GAME_STARTED", {
      lobbyId: lobby.lobbyId,
      roundId: gs.roundId,
      category: gs.categoryName,
      clueBoard16: gs.clueBoard16,
      visibleSecretForPlayer: !isFraud,
      ...(isFraud ? {} : { secretIndexIfAllowed: gs.secretIndex })
    });
  }
  
  // Everyone gets updated lobby state + scoreboard
  emitLobbyState(lobby);
  io.to(lobby.lobbyId).emit("SCORE_UPDATE", { lobbyId: lobby.lobbyId, leaderboard: getLeaderboard(lobby) });
}

function finishVoting(lobby, endedEarly) {
  const { eliminatedPlayerId, fraudEliminated } = resolveVoting(lobby);
  const scoring = applyScoringAfterVote(lobby, { eliminatedPlayerId, fraudEliminated });

  const fraudIds = lobby.gameState.fraudIds || [];
  io.to(lobby.lobbyId).emit("VOTE_REVEAL", {
    lobbyId: lobby.lobbyId,
    fraudIds,
    resultsSummary: {
      endedEarly: Boolean(endedEarly),
      eliminatedPlayerId,
      fraudEliminated: Boolean(fraudEliminated),
      summary: scoring.summary
    }
  });
  io.to(lobby.lobbyId).emit("SCORE_UPDATE", { lobbyId: lobby.lobbyId, leaderboard: getLeaderboard(lobby) });

  if (fraudEliminated) {
    endRoundToLobby(lobby, "fraud_eliminated", { fraudGuessedCorrectly: false });
    return;
  }

  // Fraud survived: allow final guess.
  lobby.gameState.phase = "fraud_guess";
  emitLobbyState(lobby);
}

function checkForGameEnd(lobby) {
  const leaderboard = getLeaderboard(lobby);
  const winner = leaderboard.find((p) => p.points >= 10);
  return winner;
}

function continueOrEndRound(lobby, reason, nextRoundInfo) {
  const winner = checkForGameEnd(lobby);
  if (winner) {
    // Game over - someone reached 10 points
    endRoundToLobby(lobby, "game_won", { winner: { playerId: winner.playerId, name: winner.name, points: winner.points } });
    return;
  }
  
  // Continue automatically - start new round
  const gs = startGameRound(lobby);
  
  // Broadcast per-player GAME_STARTED without leaking secret to frauds
  for (const p of lobby.players) {
    if (!p.connected || !p.socketId) continue;
    const isFraud = (gs.fraudIds || []).includes(p.id);
    io.to(p.socketId).emit("GAME_STARTED", {
      lobbyId: lobby.lobbyId,
      roundId: gs.roundId,
      category: gs.categoryName,
      clueBoard16: gs.clueBoard16,
      visibleSecretForPlayer: !isFraud,
      ...(isFraud ? {} : { secretIndexIfAllowed: gs.secretIndex })
    });
  }
  
  // Everyone gets updated lobby state + scoreboard
  emitLobbyState(lobby);
  io.to(lobby.lobbyId).emit("SCORE_UPDATE", { lobbyId: lobby.lobbyId, leaderboard: getLeaderboard(lobby) });
}

io.on("connection", (socket) => {
  emitLobbyList(socket);

  socket.on("LOBBY_LIST_REQUEST", (_payload, ack) => {
    const payload = { lobbies: listLobbies() };
    socket.emit("LOBBY_LIST", payload);
    if (typeof ack === "function") ack({ ok: true, ...payload });
  });

  socket.on("LOBBY_CREATE", (payload, ack) => {
    try {
      const { lobbyName, passcode, settingsDefaults } = payload || {};
      const result = createLobby({ lobbyName, passcode, settingsDefaults });
      if (!result.ok) {
        if (typeof ack === "function") ack({ ok: false, error: result.error });
        return;
      }
      lobbies.set(result.lobby.lobbyId, result.lobby);
      emitLobbyList();
      if (typeof ack === "function") ack({ ok: true, lobbyId: result.lobby.lobbyId });
    } catch {
      if (typeof ack === "function") ack({ ok: false, error: "Failed to create lobby." });
    }
  });

  socket.on("LOBBY_JOIN", (payload, ack) => {
    const { lobbyId, passcode, playerName, clientPlayerId } = payload || {};
    const lobby = lobbies.get(String(lobbyId || "").trim());
    if (!lobby) {
      const msg = "Lobby not found.";
      emitError(socket, "LOBBY_NOT_FOUND", msg);
      if (typeof ack === "function") ack({ ok: false, error: msg });
      return;
    }

    if (lobby.passcodeHash) {
      const ok = bcrypt.compareSync(String(passcode || ""), lobby.passcodeHash);
      if (!ok) {
        const msg = "Invalid passcode.";
        emitError(socket, "BAD_PASSCODE", msg);
        if (typeof ack === "function") ack({ ok: false, error: msg });
        return;
      }
    }

    const added = addOrUpdatePlayer(lobby, { clientPlayerId, playerName, socketId: socket.id });
    if (!added.ok) {
      emitError(socket, "BAD_JOIN", added.error);
      if (typeof ack === "function") ack({ ok: false, error: added.error });
      return;
    }

    // Track membership + room
    socketIndex.set(socket.id, { lobbyId: lobby.lobbyId, playerId: String(clientPlayerId) });
    socket.join(lobby.lobbyId);

    // Host assignment if missing
    const previousHost = lobby.hostPlayerId;
    if (!lobby.hostPlayerId) lobby.hostPlayerId = String(clientPlayerId);
    ensureHostValid(lobby);

    if (previousHost !== lobby.hostPlayerId) emitHostChanged(lobby);
    emitLobbyState(lobby);
    emitLobbyList();

    if (typeof ack === "function") ack({ ok: true, lobbyId: lobby.lobbyId, hostPlayerId: lobby.hostPlayerId });
  });

  socket.on("LOBBY_LEAVE", (_payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) {
      if (typeof ack === "function") ack({ ok: false, error: "Not in lobby." });
      return;
    }

    const { lobby, membership } = ctx;
    socket.leave(lobby.lobbyId);
    socketIndex.delete(socket.id);
    removePlayer(lobby, membership.playerId);

    const prevHost = lobby.hostPlayerId;
    ensureHostValid(lobby);
    if (prevHost !== lobby.hostPlayerId) emitHostChanged(lobby);

    if (lobby.players.length === 0) lobbies.delete(lobby.lobbyId);
    else emitLobbyState(lobby);

    emitLobbyList();
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("SETTINGS_UPDATE", (payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    if (!isHost(lobby, membership.playerId)) {
      emitError(socket, "NOT_HOST", "Only the host can change settings.");
      if (typeof ack === "function") ack({ ok: false, error: "Not host." });
      return;
    }
    if (lobby.gameState.phase !== "lobby") {
      emitError(socket, "IN_GAME", "Settings cannot be changed mid-round.");
      if (typeof ack === "function") ack({ ok: false, error: "In game." });
      return;
    }

    const { partialSettings } = payload || {};
    lobby.settings = { ...lobby.settings, ...(partialSettings || {}) };
    emitLobbyState(lobby);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("HOST_TRANSFER", (payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    if (!isHost(lobby, membership.playerId)) {
      emitError(socket, "NOT_HOST", "Only the host can transfer host.");
      if (typeof ack === "function") ack({ ok: false, error: "Not host." });
      return;
    }
    const { newHostPlayerId } = payload || {};
    const candidate = lobby.players.find((p) => p.id === String(newHostPlayerId));
    if (!candidate) {
      emitError(socket, "BAD_TARGET", "That player is not in the lobby.");
      if (typeof ack === "function") ack({ ok: false, error: "Bad target." });
      return;
    }
    lobby.hostPlayerId = candidate.id;
    emitHostChanged(lobby);
    emitLobbyState(lobby);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("GAME_START", (_payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    if (!isHost(lobby, membership.playerId)) {
      emitError(socket, "NOT_HOST", "Only the host can start the game.");
      if (typeof ack === "function") ack({ ok: false, error: "Not host." });
      return;
    }

    const gs = startGameRound(lobby);

    // Broadcast per-player GAME_STARTED without leaking secret to frauds
    for (const p of lobby.players) {
      if (!p.connected || !p.socketId) continue;
      const isFraud = (gs.fraudIds || []).includes(p.id);
      io.to(p.socketId).emit("GAME_STARTED", {
        lobbyId: lobby.lobbyId,
        roundId: gs.roundId,
        category: gs.categoryName,
        clueBoard16: gs.clueBoard16,
        visibleSecretForPlayer: !isFraud,
        ...(isFraud ? {} : { secretIndexIfAllowed: gs.secretIndex })
      });
    }

    // Everyone gets updated lobby state + scoreboard
    emitLobbyState(lobby);
    io.to(lobby.lobbyId).emit("SCORE_UPDATE", { lobbyId: lobby.lobbyId, leaderboard: getLeaderboard(lobby) });
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("CHAT_SEND", (payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    const msg = safeMessage(payload?.message);
    if (!msg) {
      if (typeof ack === "function") ack({ ok: false, error: "Empty message." });
      return;
    }
    const sender = lobby.players.find((p) => p.id === membership.playerId);
    const messageObj = {
      id: nanoid(10),
      at: Date.now(),
      fromPlayerId: membership.playerId,
      fromName: sender ? sender.name : "Unknown",
      text: msg
    };
    io.to(lobby.lobbyId).emit("CHAT_MESSAGE", { lobbyId: lobby.lobbyId, messageObj });
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("VOTE_SUBMIT", (payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    if (lobby.gameState.phase !== "voting") {
      emitError(socket, "NOT_VOTING", "Voting is not active.");
      if (typeof ack === "function") ack({ ok: false, error: "Not voting." });
      return;
    }
    const targetPlayerId = String(payload?.targetPlayerId || "").trim();
    if (!targetPlayerId) {
      if (typeof ack === "function") ack({ ok: false, error: "Missing vote target." });
      return;
    }
    lobby.gameState.votesByVoterId[membership.playerId] = targetPlayerId;
    const voteState = computeVoteState(lobby);
    io.to(lobby.lobbyId).emit("VOTE_STATE", { lobbyId: lobby.lobbyId, ...voteState });
    if (typeof ack === "function") ack({ ok: true });

    if (voteState.allSubmittedBoolean) finishVoting(lobby, false);
  });

  socket.on("VOTE_TO_START_VOTING", (_payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    if (lobby.gameState.phase !== "clues") {
      emitError(socket, "BAD_PHASE", "Voting can only start after the round starts.");
      if (typeof ack === "function") ack({ ok: false, error: "Bad phase." });
      return;
    }
    
    // Initialize voteToStartVoterIds if not exists
    if (!lobby.gameState.voteToStartVoterIds) {
      lobby.gameState.voteToStartVoterIds = new Set();
    }
    
    // Add player's vote
    lobby.gameState.voteToStartVoterIds.add(membership.playerId);
    
    // Check if enough players voted (50% or more)
    const connectedPlayers = lobby.players.filter((p) => p.connected);
    const voteCount = lobby.gameState.voteToStartVoterIds.size;
    const requiredVotes = Math.ceil(connectedPlayers.length * 0.5);
    
    // Broadcast vote state
    io.to(lobby.lobbyId).emit("VOTE_STATE", {
      lobbyId: lobby.lobbyId,
      voteToStartCount: voteCount,
      voteToStartRequired: requiredVotes
    });
    
    if (typeof ack === "function") ack({ ok: true, voteCount, requiredVotes });
    
    // Start voting if threshold reached
    if (voteCount >= requiredVotes) {
      lobby.gameState.phase = "voting";
      lobby.gameState.votesByVoterId = {};
      lobby.gameState.voteToStartVoterIds = new Set();
      emitLobbyState(lobby);
      io.to(lobby.lobbyId).emit("VOTE_STATE", { lobbyId: lobby.lobbyId, ...computeVoteState(lobby) });
    }
  });

  socket.on("VOTING_START", (_payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    if (!isHost(lobby, membership.playerId)) {
      emitError(socket, "NOT_HOST", "Only the host can start voting.");
      if (typeof ack === "function") ack({ ok: false, error: "Not host." });
      return;
    }
    if (lobby.gameState.phase !== "clues") {
      emitError(socket, "BAD_PHASE", "Voting can only start after the round starts.");
      if (typeof ack === "function") ack({ ok: false, error: "Bad phase." });
      return;
    }
    lobby.gameState.phase = "voting";
    lobby.gameState.votesByVoterId = {};
    if (lobby.gameState.voteToStartVoterIds) {
      lobby.gameState.voteToStartVoterIds = new Set();
    }
    emitLobbyState(lobby);
    io.to(lobby.lobbyId).emit("VOTE_STATE", { lobbyId: lobby.lobbyId, ...computeVoteState(lobby) });
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("VOTING_END_EARLY", (_payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    if (!isHost(lobby, membership.playerId)) {
      emitError(socket, "NOT_HOST", "Only the host can end voting early.");
      if (typeof ack === "function") ack({ ok: false, error: "Not host." });
      return;
    }
    if (lobby.gameState.phase !== "voting") {
      emitError(socket, "NOT_VOTING", "Voting is not active.");
      if (typeof ack === "function") ack({ ok: false, error: "Not voting." });
      return;
    }
    finishVoting(lobby, true);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("FRAUD_GUESS", (payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby } = ctx;
    if (lobby.gameState.phase !== "fraud_guess") {
      emitError(socket, "NOT_GUESSING", "Fraud guess is not active.");
      if (typeof ack === "function") ack({ ok: false, error: "Not guessing." });
      return;
    }

    const rawGuessIndex = payload?.guessIndex;
    const guessIndex = typeof rawGuessIndex === "number" ? rawGuessIndex : null;

    const { correct } = applyFraudGuess(lobby, guessIndex);
    endRoundToLobby(lobby, "fraud_guess_done", { fraudGuessedCorrectly: correct });
    if (typeof ack === "function") ack({ ok: true, correct });
  });

  socket.on("ROUND_END", (_payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    if (!isHost(lobby, membership.playerId)) {
      emitError(socket, "NOT_HOST", "Only the host can end the round.");
      if (typeof ack === "function") ack({ ok: false, error: "Not host." });
      return;
    }
    endRoundToLobby(lobby, "host_ended_round", null);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const m = socketIndex.get(socket.id);
    if (!m) return;
    socketIndex.delete(socket.id);
    const lobby = lobbies.get(m.lobbyId);
    if (!lobby) return;

    // Remove player immediately for MVP.
    removePlayer(lobby, m.playerId);

    const prevHost = lobby.hostPlayerId;
    ensureHostValid(lobby);
    if (prevHost !== lobby.hostPlayerId) emitHostChanged(lobby);

    if (lobby.players.length === 0) lobbies.delete(lobby.lobbyId);
    else emitLobbyState(lobby);

    emitLobbyList();
  });
});

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (${NODE_ENV})`);
});

