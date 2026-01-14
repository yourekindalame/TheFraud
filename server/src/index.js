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
  // Only show public (non-private) lobbies in the list
  return [...lobbies.values()]
    .filter((l) => !l.isPrivate)
    .map(publicLobbySummary)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function emitLobbyList(target) {
  const payload = { lobbies: listLobbies() };
  if (target) target.emit("LOBBY_LIST", payload);
  else io.emit("LOBBY_LIST", payload);
}

function emitLobbyState(lobby, requestingPlayerId) {
  // Broadcast to all players, but each only gets their own clue
  for (const p of lobby.players) {
    if (!p.connected || !p.socketId) continue;
    io.to(p.socketId).emit("LOBBY_STATE", publicLobbyState(lobby, p.id));
  }
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

function startNextRound(lobby) {
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
    io.to(lobby.lobbyId).emit("SCORE_UPDATE", { lobbyId: lobby.lobbyId, leaderboard: getLeaderboard(lobby) });
    return;
  }
  
  // Start new round
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

function endRoundToLobby(lobby, reason, roundResults) {
  // Store round results in gameState temporarily
  const { voteCountsByTargetId } = computeVoteState(lobby);
  const fraudIds = lobby.gameState.fraudIds || [];
  const fraudNames = fraudIds.map((id) => {
    const p = lobby.players.find((pl) => pl.id === id);
    return p ? p.name : "Unknown";
  });
  const correctWord = lobby.gameState.clueBoard16?.[lobby.gameState.secretIndex] || "Unknown";
  
  // Determine majority vote
  const entries = Object.entries(voteCountsByTargetId || {});
  let majorityVote = false;
  if (entries.length > 0) {
    entries.sort((a, b) => b[1] - a[1]);
    const topCount = entries[0][1];
    const connectedCount = lobby.players.filter((p) => p.connected).length;
    majorityVote = topCount > Math.floor(connectedCount / 2);
  }
  
  // Determine eliminated player info
  let eliminatedPlayerId = null;
  let eliminatedPlayerName = null;
  if (reason === "fraud_eliminated" || (roundResults && roundResults.eliminatedPlayerId)) {
    eliminatedPlayerId = roundResults?.eliminatedPlayerId || null;
    if (eliminatedPlayerId) {
      const eliminated = lobby.players.find((p) => p.id === eliminatedPlayerId);
      eliminatedPlayerName = eliminated ? eliminated.name : "Unknown";
    }
  }
  
  // Determine fraud guess info
  let fraudGuessedCorrectly = null;
  let fraudGuessWord = null;
  if (reason === "fraud_guess_done" && roundResults) {
    fraudGuessedCorrectly = roundResults.fraudGuessedCorrectly || false;
    if (roundResults.fraudGuessIndex !== null && typeof roundResults.fraudGuessIndex === "number") {
      fraudGuessWord = lobby.gameState.clueBoard16?.[roundResults.fraudGuessIndex] || null;
    }
  }
  
  const fraudWon = reason === "fraud_guess_done" && !roundResults?.fraudEliminated;
  const fraudLost = reason === "fraud_eliminated";
  
  // Emit ROUND_ENDED with all results
  io.to(lobby.lobbyId).emit("ROUND_ENDED", {
    lobbyId: lobby.lobbyId,
    results: {
      fraudWon,
      fraudLost,
      majorityVote,
      fraudIds,
      fraudNames,
      correctWord,
      fraudGuessedCorrectly,
      fraudGuessWord,
      eliminatedPlayerId,
      eliminatedPlayerName
    }
  });
  
  // Update scoreboard
  io.to(lobby.lobbyId).emit("SCORE_UPDATE", { lobbyId: lobby.lobbyId, leaderboard: getLeaderboard(lobby) });
  
  // Change phase to show results screen (clients will handle showing modal)
  lobby.gameState.phase = "round_results";
  emitLobbyState(lobby);
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

  // Fraud ALWAYS gets to guess after voting, regardless of voting outcome
  lobby.gameState.phase = "fraud_guess";
  emitLobbyState(lobby);
  
  // Emit FRAUD_GUESS_PROMPT only to Fraud players
  for (const fraudId of fraudIds) {
    const fraudPlayer = lobby.players.find((p) => p.id === fraudId);
    if (fraudPlayer && fraudPlayer.connected && fraudPlayer.socketId) {
      io.to(fraudPlayer.socketId).emit("FRAUD_GUESS_PROMPT", {
        lobbyId: lobby.lobbyId,
        category: lobby.gameState.categoryName,
        clueBoard16: lobby.gameState.clueBoard16
      });
    }
  }
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
      const { lobbyName, isPrivate, settingsDefaults } = payload || {};
      const result = createLobby({ lobbyName, isPrivate, settingsDefaults });
      if (!result.ok) {
        if (typeof ack === "function") ack({ ok: false, error: result.error });
        return;
      }
      lobbies.set(result.lobby.lobbyId, result.lobby);
      emitLobbyList();
      if (typeof ack === "function") ack({ ok: true, lobbyId: result.lobby.lobbyId, lobbyCode: result.lobby.lobbyCode });
    } catch {
      if (typeof ack === "function") ack({ ok: false, error: "Failed to create lobby." });
    }
  });

  socket.on("LOBBY_JOIN", (payload, ack) => {
    const { lobbyId, lobbyCode, playerName, clientPlayerId, profileImage } = payload || {};
    let lobby = null;

    // Two join methods:
    // 1. Join by lobbyId (public lobby from list - no code required)
    // 2. Join by lobbyCode (private lobby or direct code entry - requires code match)
    
    if (lobbyId) {
      // Method 1: Join by ID (public lobby)
      const requestedLobbyId = String(lobbyId || "").trim().toUpperCase();
      lobby = lobbies.get(requestedLobbyId);
      if (!lobby) {
        const msg = "Lobby not found.";
        emitError(socket, "LOBBY_NOT_FOUND", msg);
        if (typeof ack === "function") ack({ ok: false, error: msg });
        return;
      }
      // Public lobbies joined by ID don't require code check
      // Private lobbies still require code even if ID is provided
      if (lobby.isPrivate) {
        const providedCode = String(lobbyCode || "").trim().toUpperCase();
        if (providedCode !== lobby.lobbyCode.toUpperCase()) {
          const msg = "Private lobby requires Lobby Code.";
          emitError(socket, "BAD_LOBBY_CODE", msg);
          if (typeof ack === "function") ack({ ok: false, error: msg });
          return;
        }
      }
    } else if (lobbyCode) {
      // Method 2: Join by code (find lobby by matching code)
      const providedCode = String(lobbyCode || "").trim().toUpperCase();
      // Search all lobbies for matching code
      for (const [id, l] of lobbies.entries()) {
        if (l.lobbyCode.toUpperCase() === providedCode) {
          lobby = l;
          break;
        }
      }
      if (!lobby) {
        const msg = "Invalid Lobby Code.";
        emitError(socket, "BAD_LOBBY_CODE", msg);
        if (typeof ack === "function") ack({ ok: false, error: msg });
        return;
      }
    } else {
      const msg = "Lobby ID or Lobby Code required.";
      emitError(socket, "BAD_JOIN", msg);
      if (typeof ack === "function") ack({ ok: false, error: msg });
      return;
    }

    const added = addOrUpdatePlayer(lobby, { clientPlayerId, playerName, socketId: socket.id, profileImage });
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

    if (typeof ack === "function") ack({ ok: true, lobbyId: lobby.lobbyId, hostPlayerId: lobby.hostPlayerId, lobbyCode: lobby.lobbyCode });
  });

  socket.on("PROFILE_UPDATE", (payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) {
      if (typeof ack === "function") ack({ ok: false, error: "Not in lobby." });
      return;
    }
    const { lobby, membership } = ctx;
    const { profileImage } = payload || {};
    
    // Validate and limit profile image size
    let profileImageValue = null;
    if (profileImage && typeof profileImage === "string") {
      if (profileImage.length < 1000000) { // 1MB limit
        profileImageValue = profileImage;
      }
    } else if (profileImage === null) {
      profileImageValue = null; // Allow clearing profile image
    }
    
    const player = lobby.players.find((p) => p.id === membership.playerId);
    if (player) {
      player.profileImage = profileImageValue;
      emitLobbyState(lobby);
      if (typeof ack === "function") ack({ ok: true });
    } else {
      if (typeof ack === "function") ack({ ok: false, error: "Player not found." });
    }
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

  socket.on("CLUE_SUBMIT", (payload, ack) => {
    const ctx = requireMembership(socket);
    if (!ctx) return;
    const { lobby, membership } = ctx;
    if (lobby.gameState.phase !== "clues") {
      emitError(socket, "NOT_CLUES_PHASE", "Clue submission is only allowed during clues phase.");
      if (typeof ack === "function") ack({ ok: false, error: "Not in clues phase." });
      return;
    }
    const clue = safeMessage(payload?.clue);
    if (!clue) {
      if (typeof ack === "function") ack({ ok: false, error: "Empty clue." });
      return;
    }
    // Store clue for this player in this round
    if (!lobby.gameState.cluesByPlayerId) {
      lobby.gameState.cluesByPlayerId = {};
    }
    lobby.gameState.cluesByPlayerId[membership.playerId] = clue.trim();
    // Broadcast updated state so player sees their saved clue
    emitLobbyState(lobby);
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
    
    // Emit FRAUD_GUESS_RESULT to all players
    io.to(lobby.lobbyId).emit("FRAUD_GUESS_RESULT", {
      lobbyId: lobby.lobbyId,
      isCorrect: correct,
      guessIndex: guessIndex,
      secretIndex: lobby.gameState.secretIndex
    });
    
    // Update scoreboard
    io.to(lobby.lobbyId).emit("SCORE_UPDATE", { lobbyId: lobby.lobbyId, leaderboard: getLeaderboard(lobby) });
    
    // Auto-start next round after 10 seconds
    lobby.gameState.phase = "fraud_guess_result";
    setTimeout(() => {
      // Check if lobby still exists and is still in result phase
      const currentLobby = lobbies.get(lobby.lobbyId);
      if (currentLobby && currentLobby.gameState.phase === "fraud_guess_result") {
        startNextRound(currentLobby);
      }
    }, 10000);
    
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

