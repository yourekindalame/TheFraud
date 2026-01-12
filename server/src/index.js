require("dotenv").config();

const http = require("node:http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");

const {
  lobbies,
  publicLobbySummary,
  publicLobbyState,
  getLeaderboard,
  getWinnerIfAny,
  sanitizeClue,
  sanitizeChat,
  isHost,
  createLobby,
  findLobbyByIdOrCode,
  addOrReconnectPlayer,
  removePlayer,
  setDisconnected,
  startGameRound,
  computeVoteState,
  resolveVoting,
  applyScoringAfterVote,
  applyFraudGuess,
  getCategoryMeta,
  getClueBoardForLobby,
  getCorrectWord,
} = require("./state");

const PORT = Number(process.env.PORT || 8080);

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/meta", (_req, res) => {
  res.status(200).json({ categories: getCategoryMeta() });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

/**
 * socketId -> { lobbyId, playerId }
 */
const socketIndex = new Map();

function emitLobbyList() {
  const summaries = [];
  for (const lobby of lobbies.values()) {
    if (lobby.isPrivate) continue;
    summaries.push(publicLobbySummary(lobby));
  }
  io.emit("LOBBY_LIST", { lobbies: summaries });
}

function emitLobbyStateToAll(lobby) {
  for (const p of lobby.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit("LOBBY_STATE", publicLobbyState(lobby, p.id));
  }
}

function emitVoteState(lobby) {
  const { votesByVoterId, voteCountsByTargetId, allSubmittedBoolean } = computeVoteState(lobby);
  io.to(lobby.lobbyId).emit("VOTE_STATE", {
    lobbyId: lobby.lobbyId,
    votesByVoterId,
    voteCountsByTargetId,
    allSubmittedBoolean,
  });
}

function emitVoteToStartState(lobby) {
  const voteToStartCount = lobby.gameState.voteToStartVoterIds.size;
  const required = Math.floor(lobby.players.length / 2) + 1; // 50%+ (strict)
  io.to(lobby.lobbyId).emit("VOTE_STATE", {
    lobbyId: lobby.lobbyId,
    voteToStartCount,
    voteToStartRequired: required,
  });
}

function emitScore(lobby) {
  io.to(lobby.lobbyId).emit("SCORE_UPDATE", {
    lobbyId: lobby.lobbyId,
    leaderboard: getLeaderboard(lobby),
  });
}

function sendError(socket, code, message) {
  socket.emit("ERROR", { code, message });
}

function ensureLobbyAndPlayer(socket) {
  const idx = socketIndex.get(socket.id);
  if (!idx) return { ok: false, error: "Not in lobby." };
  const lobby = lobbies.get(idx.lobbyId);
  if (!lobby) return { ok: false, error: "Lobby not found." };
  const playerId = idx.playerId;
  const player = lobby.players.find((p) => p.id === playerId) ?? null;
  if (!player) return { ok: false, error: "Player not in lobby." };
  return { ok: true, lobby, playerId, player };
}

/**
 * REQUIRED FLOW:
 * - resolve vote totals + majority + eliminated + fraud eliminated
 * - emit VOTE_REVEAL
 * - if at least one fraud survives => phase fraud_guess + FRAUD_GUESS_PROMPT (fraud-only)
 * - otherwise end round => ROUND_ENDED exactly once
 */
function finishVoting(lobby, endedEarly) {
  const gs = lobby.gameState;
  if (gs.phase !== "voting") return;
  if (gs.roundEnded) return;

  const { majorityVote, eliminatedPlayerId, fraudEliminated } = resolveVoting(lobby);

  // Persist last vote result for deterministic round resolution.
  gs.lastVoteResult = {
    endedEarly: Boolean(endedEarly),
    eliminatedPlayerId,
    fraudEliminated,
    majorityVote,
  };

  const fraudIds = gs.fraudIds.slice();
  const eliminated = eliminatedPlayerId ?? null;
  const survivingFraudIds = eliminated ? fraudIds.filter((id) => id !== eliminated) : fraudIds;

  const summaryParts = [];
  summaryParts.push(majorityVote ? "Majority vote reached." : "No majority vote.");
  if (eliminatedPlayerId) summaryParts.push(`Eliminated: ${eliminatedPlayerId}.`);
  if (fraudEliminated) summaryParts.push("A Fraud was eliminated.");
  else summaryParts.push("No Fraud eliminated.");

  io.to(lobby.lobbyId).emit("VOTE_REVEAL", {
    lobbyId: lobby.lobbyId,
    fraudIds,
    resultsSummary: {
      endedEarly: Boolean(endedEarly),
      eliminatedPlayerId,
      fraudEliminated: Boolean(fraudEliminated),
      summary: summaryParts.join(" "),
    },
  });

  // Apply post-vote scoring immediately (authoritative).
  applyScoringAfterVote(lobby, { eliminatedPlayerId, fraudEliminated });
  emitScore(lobby);

  // Fraud guess phase (ONLY if any fraud survives voting)
  if (survivingFraudIds.length > 0) {
    gs.phase = "fraud_guess";
    emitLobbyStateToAll(lobby);

    const category = gs.categoryName;
    const clueBoard16 = getClueBoardForLobby(lobby);
    // emit only to fraud players
    for (const p of lobby.players) {
      if (!p.socketId) continue;
      if (!survivingFraudIds.includes(p.id)) continue;
      io.to(p.socketId).emit("FRAUD_GUESS_PROMPT", {
        lobbyId: lobby.lobbyId,
        category,
        clueBoard16,
      });
    }
    return;
  }

  // No surviving fraud => end round now
  endRoundToResults(lobby, { fraudGuessedCorrectly: undefined, fraudGuessWord: undefined });
}

function endRoundToResults(lobby, { fraudGuessedCorrectly, fraudGuessWord }) {
  const gs = lobby.gameState;
  if (gs.roundEnded) return;
  gs.roundEnded = true;

  const fraudIds = gs.fraudIds.slice();
  const fraudNames = fraudIds
    .map((id) => lobby.players.find((p) => p.id === id)?.name)
    .filter(Boolean);

  const correctWord = getCorrectWord(lobby) ?? "";
  const lastVote = gs.lastVoteResult ?? { majorityVote: false, eliminatedPlayerId: undefined };
  const majorityVote = Boolean(lastVote.majorityVote);

  const eliminatedPlayerId = lastVote.eliminatedPlayerId;
  const eliminatedPlayerName = eliminatedPlayerId
    ? lobby.players.find((p) => p.id === eliminatedPlayerId)?.name
    : undefined;

  const survivingFraudIds = eliminatedPlayerId ? fraudIds.filter((id) => id !== eliminatedPlayerId) : fraudIds;
  const fraudSurvivedVoting = survivingFraudIds.length > 0;

  const fraudWon = Boolean(fraudSurvivedVoting && fraudGuessedCorrectly === true);
  const fraudLost = Boolean(!fraudSurvivedVoting || fraudGuessedCorrectly === false || fraudGuessedCorrectly === undefined);

  const winner = getWinnerIfAny(lobby, 10) ?? undefined;

  gs.phase = "round_results";
  emitLobbyStateToAll(lobby);

  io.to(lobby.lobbyId).emit("ROUND_ENDED", {
    lobbyId: lobby.lobbyId,
    results: {
      fraudWon,
      fraudLost,
      majorityVote,
      fraudIds,
      fraudNames,
      correctWord,
      ...(typeof fraudGuessedCorrectly === "boolean" ? { fraudGuessedCorrectly } : {}),
      ...(fraudGuessWord ? { fraudGuessWord } : {}),
      ...(eliminatedPlayerId ? { eliminatedPlayerId } : {}),
      ...(eliminatedPlayerName ? { eliminatedPlayerName } : {}),
      ...(winner ? { winner } : {}),
    },
  });

  // Score already applied during voting and (optionally) fraud guess, but re-emit for safety.
  emitScore(lobby);
}

io.on("connection", (socket) => {
  socket.on("LOBBY_LIST_REQUEST", (_payload, cb) => {
    try {
      emitLobbyList();
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: "Failed to fetch lobby list." });
    }
  });

  socket.on("LOBBY_CREATE", (payload, cb) => {
    try {
      const { lobbyName, isPrivate, settingsDefaults } = payload ?? {};
      const res = createLobby({ lobbyName, isPrivate, settingsDefaults });
      if (!res.ok) return cb?.(res);
      emitLobbyList();
      cb?.(res);
    } catch (e) {
      cb?.({ ok: false, error: "Failed to create lobby." });
    }
  });

  socket.on("LOBBY_JOIN", (payload, cb) => {
    try {
      const { lobbyId, lobbyCode, playerName, clientPlayerId } = payload ?? {};
      const lobby = findLobbyByIdOrCode({ lobbyId, lobbyCode });
      if (!lobby) return cb?.({ ok: false, error: "Lobby not found." });

      if (lobby.isPrivate && !lobbyCode) {
        return cb?.({ ok: false, error: "PRIVATE_LOBBY_REQUIRES_CODE" });
      }

      const res = addOrReconnectPlayer({
        lobby,
        playerName,
        clientPlayerId,
        socketId: socket.id,
      });
      if (!res.ok) return cb?.(res);

      socketIndex.set(socket.id, { lobbyId: lobby.lobbyId, playerId: res.player.id });
      socket.join(lobby.lobbyId);

      emitLobbyStateToAll(lobby);
      emitScore(lobby);
      emitLobbyList();

      cb?.({
        ok: true,
        lobbyId: lobby.lobbyId,
        hostPlayerId: lobby.hostPlayerId,
        lobbyCode: lobby.lobbyCode,
      });
    } catch (e) {
      cb?.({ ok: false, error: "Failed to join lobby." });
    }
  });

  socket.on("LOBBY_LEAVE", (payload, cb) => {
    try {
      const { lobbyId } = payload ?? {};
      const idx = socketIndex.get(socket.id);
      if (!idx || idx.lobbyId !== lobbyId) return cb?.({ ok: false, error: "Not in lobby." });
      const lobby = lobbies.get(idx.lobbyId);
      if (!lobby) return cb?.({ ok: false, error: "Lobby not found." });

      removePlayer({ lobby, playerId: idx.playerId });
      socketIndex.delete(socket.id);
      socket.leave(lobby.lobbyId);

      emitLobbyStateToAll(lobby);
      emitScore(lobby);
      emitLobbyList();
      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: "Failed to leave lobby." });
    }
  });

  socket.on("SETTINGS_UPDATE", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;

    if (!isHost(lobby, playerId)) {
      sendError(socket, "NOT_HOST", "Only host can change settings.");
      return cb?.({ ok: false, error: "NOT_HOST" });
    }
    if (lobby.gameState.phase !== "lobby") return cb?.({ ok: false, error: "BAD_PHASE" });

    const { partialSettings } = payload ?? {};
    lobby.settings = { ...lobby.settings, ...(partialSettings ?? {}) };
    emitLobbyStateToAll(lobby);
    cb?.({ ok: true });
  });

  socket.on("HOST_TRANSFER", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    if (!isHost(lobby, playerId)) return cb?.({ ok: false, error: "NOT_HOST" });

    const newHostPlayerId = String(payload?.newHostPlayerId ?? "");
    if (!lobby.players.some((p) => p.id === newHostPlayerId)) return cb?.({ ok: false, error: "Bad player." });
    lobby.hostPlayerId = newHostPlayerId;

    io.to(lobby.lobbyId).emit("HOST_CHANGED", { lobbyId: lobby.lobbyId, hostPlayerId: newHostPlayerId });
    emitLobbyStateToAll(lobby);
    cb?.({ ok: true });
  });

  socket.on("GAME_START", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;

    if (!isHost(lobby, playerId)) return cb?.({ ok: false, error: "NOT_HOST" });
    if (lobby.gameState.phase !== "lobby" && lobby.gameState.phase !== "round_results") {
      return cb?.({ ok: false, error: "BAD_PHASE" });
    }
    if (lobby.players.length < 3) return cb?.({ ok: false, error: "Need at least 3 players." });

    const round = startGameRound(lobby);
    emitLobbyStateToAll(lobby);
    emitScore(lobby);
    emitLobbyList();

    // per-player payload (do not reveal secret to fraud)
    for (const p of lobby.players) {
      if (!p.socketId) continue;
      const isFraud = round.fraudIds.includes(p.id);
      io.to(p.socketId).emit("GAME_STARTED", {
        lobbyId: lobby.lobbyId,
        roundId: round.roundId,
        category: round.categoryName,
        clueBoard16: round.clueBoard16,
        visibleSecretForPlayer: !isFraud,
        ...(!isFraud ? { secretIndexIfAllowed: round.secretIndex } : {}),
      });
    }
    cb?.({ ok: true });
  });

  socket.on("CLUE_SUBMIT", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    if (lobby.gameState.phase !== "clues") return cb?.({ ok: false, error: "BAD_PHASE" });

    const clue = sanitizeClue(payload?.clue);
    if (!clue) return cb?.({ ok: false, error: "Empty clue." });
    lobby.gameState.cluesByPlayerId[playerId] = clue;

    emitLobbyStateToAll(lobby); // filtered (only own clue visible during clues phase)
    cb?.({ ok: true });
  });

  socket.on("VOTE_TO_START_VOTING", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    if (lobby.gameState.phase !== "clues") return cb?.({ ok: false, error: "BAD_PHASE" });

    lobby.gameState.voteToStartVoterIds.add(playerId);
    const voteCount = lobby.gameState.voteToStartVoterIds.size;
    const requiredVotes = Math.floor(lobby.players.length / 2) + 1;

    emitVoteToStartState(lobby);

    if (voteCount >= requiredVotes) {
      lobby.gameState.phase = "voting";
      emitLobbyStateToAll(lobby);
      emitVoteState(lobby);
    }

    cb?.({ ok: true, voteCount, requiredVotes });
  });

  socket.on("VOTING_START", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    if (!isHost(lobby, playerId)) return cb?.({ ok: false, error: "NOT_HOST" });
    if (lobby.gameState.phase !== "clues") return cb?.({ ok: false, error: "BAD_PHASE" });

    lobby.gameState.phase = "voting";
    emitLobbyStateToAll(lobby);
    emitVoteState(lobby);
    cb?.({ ok: true });
  });

  socket.on("VOTE_SUBMIT", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    if (lobby.gameState.phase !== "voting") return cb?.({ ok: false, error: "BAD_PHASE" });

    const targetPlayerId = String(payload?.targetPlayerId ?? "");
    if (!lobby.players.some((p) => p.id === targetPlayerId)) return cb?.({ ok: false, error: "Bad target." });

    lobby.gameState.votesByVoterId[playerId] = targetPlayerId;
    emitVoteState(lobby);

    const { allSubmittedBoolean } = computeVoteState(lobby);
    if (allSubmittedBoolean) finishVoting(lobby, false);

    cb?.({ ok: true });
  });

  socket.on("VOTING_END_EARLY", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    if (!isHost(lobby, playerId)) return cb?.({ ok: false, error: "NOT_HOST" });
    if (lobby.gameState.phase !== "voting") return cb?.({ ok: false, error: "BAD_PHASE" });

    finishVoting(lobby, true);
    cb?.({ ok: true });
  });

  socket.on("FRAUD_GUESS", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    const gs = lobby.gameState;
    if (gs.phase !== "fraud_guess") return cb?.({ ok: false, error: "BAD_PHASE" });
    if (gs.roundEnded) return cb?.({ ok: false, error: "ROUND_ENDED" });

    const eliminatedId = gs.lastVoteResult?.eliminatedPlayerId;
    const fraudIds = gs.fraudIds.slice();
    const survivingFraudIds = eliminatedId ? fraudIds.filter((id) => id !== eliminatedId) : fraudIds;
    if (!survivingFraudIds.includes(playerId)) {
      sendError(socket, "NOT_GUESSING", "Only a surviving Fraud may guess.");
      return cb?.({ ok: false, error: "NOT_GUESSING" });
    }

    if (gs.fraudGuess) return cb?.({ ok: false, error: "Guess already submitted." });

    const guessIndexRaw = payload?.guessIndex;
    const guessIndex =
      guessIndexRaw === null
        ? null
        : Number.isInteger(guessIndexRaw)
          ? guessIndexRaw
          : Number.isInteger(Number(guessIndexRaw))
            ? Number(guessIndexRaw)
            : NaN;

    if (guessIndex !== null && (!Number.isInteger(guessIndex) || guessIndex < 0 || guessIndex > 15)) {
      return cb?.({ ok: false, error: "guessIndex must be 0-15 or null." });
    }

    const { correct } = applyFraudGuess(lobby, guessIndex);
    const fraudGuessWord =
      guessIndex === null ? undefined : (getClueBoardForLobby(lobby)?.[guessIndex] ?? undefined);

    gs.fraudGuess = {
      guessedByPlayerId: playerId,
      guessIndex,
      correct,
    };

    // Round resolution ALWAYS, exactly once.
    endRoundToResults(lobby, {
      fraudGuessedCorrectly: Boolean(correct),
      fraudGuessWord: correct ? undefined : fraudGuessWord, // only include incorrect guessed word
    });

    cb?.({ ok: true, correct });
  });

  socket.on("ROUND_NEXT", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    if (!isHost(lobby, playerId)) return cb?.({ ok: false, error: "NOT_HOST" });
    if (lobby.gameState.phase !== "round_results") return cb?.({ ok: false, error: "BAD_PHASE" });

    // next round == GAME_START semantics
    const round = startGameRound(lobby);
    emitLobbyStateToAll(lobby);
    emitScore(lobby);
    emitLobbyList();

    for (const p of lobby.players) {
      if (!p.socketId) continue;
      const isFraud = round.fraudIds.includes(p.id);
      io.to(p.socketId).emit("GAME_STARTED", {
        lobbyId: lobby.lobbyId,
        roundId: round.roundId,
        category: round.categoryName,
        clueBoard16: round.clueBoard16,
        visibleSecretForPlayer: !isFraud,
        ...(!isFraud ? { secretIndexIfAllowed: round.secretIndex } : {}),
      });
    }

    cb?.({ ok: true });
  });

  socket.on("END_GAME", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    if (!isHost(lobby, playerId)) return cb?.({ ok: false, error: "NOT_HOST" });

    lobby.gameState.phase = "lobby";
    lobby.gameState.roundId = null;
    lobby.gameState.categoryId = null;
    lobby.gameState.categoryName = null;
    lobby.gameState.clueBoard16 = null;
    lobby.gameState.secretIndex = null;
    lobby.gameState.fraudIds = [];
    lobby.gameState.votesByVoterId = {};
    lobby.gameState.voteToStartVoterIds = new Set();
    lobby.gameState.cluesByPlayerId = {};
    lobby.gameState.lastVoteResult = null;
    lobby.gameState.roundEnded = false;
    lobby.gameState.fraudGuess = null;

    emitLobbyStateToAll(lobby);
    emitLobbyList();
    cb?.({ ok: true });
  });

  socket.on("CHAT_SEND", (payload, cb) => {
    const ctx = ensureLobbyAndPlayer(socket);
    if (!ctx.ok) return cb?.({ ok: false, error: ctx.error });
    const { lobby, playerId } = ctx;
    const player = lobby.players.find((p) => p.id === playerId);
    if (!player) return cb?.({ ok: false, error: "Player not found." });

    const text = sanitizeChat(payload?.message);
    if (!text) return cb?.({ ok: false, error: "Empty message." });

    const msg = {
      id: nanoid(),
      at: Date.now(),
      fromPlayerId: playerId,
      fromName: player.name,
      text,
    };
    lobby.chat.push(msg);
    io.to(lobby.lobbyId).emit("CHAT_MESSAGE", { lobbyId: lobby.lobbyId, messageObj: msg });
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const idx = socketIndex.get(socket.id);
    if (!idx) return;

    const lobby = lobbies.get(idx.lobbyId);
    if (lobby) {
      setDisconnected({ lobby, playerId: idx.playerId });
      emitLobbyStateToAll(lobby);
      emitLobbyList();
    }
    socketIndex.delete(socket.id);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});

