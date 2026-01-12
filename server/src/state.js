const fs = require("node:fs");
const path = require("node:path");
const { nanoid } = require("nanoid");

function now() {
  return Date.now();
}

function makeLobbyCode() {
  // 6 chars, uppercase-ish, no ambiguous chars
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function clampInt(n, min, max) {
  const x = Number.isFinite(n) ? Math.trunc(n) : NaN;
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function sanitizeName(name) {
  const s = String(name ?? "").trim().replace(/\s+/g, " ");
  return s.slice(0, 24);
}

function sanitizeClue(clue) {
  const s = String(clue ?? "").trim();
  // one-word-ish: keep letters/numbers/'-; collapse spaces
  const one = s.replace(/\s+/g, " ").split(" ")[0] ?? "";
  return one.slice(0, 32);
}

function sanitizeChat(message) {
  const s = String(message ?? "").trim().replace(/\s+/g, " ");
  return s.slice(0, 180);
}

function loadCluesJson() {
  const p = path.join(__dirname, "..", "data", "clues.json");
  const raw = fs.readFileSync(p, "utf8");
  const parsed = JSON.parse(raw);
  const categories = Array.isArray(parsed?.categories) ? parsed.categories : [];
  return categories.map((c) => ({
    id: String(c.id),
    name: String(c.name),
    icon: String(c.icon ?? ""),
    boards: Array.isArray(c.boards)
      ? c.boards.map((b) => ({
          name: String(b.name ?? ""),
          clues16: Array.isArray(b.clues16) ? b.clues16.map((x) => String(x)) : [],
        }))
      : [],
  }));
}

function loadBannedWords() {
  const p = path.join(__dirname, "..", "data", "banned-words.txt");
  if (!fs.existsSync(p)) return new Set();
  const raw = fs.readFileSync(p, "utf8");
  const words = raw
    .split("\n")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return new Set(words);
}

const categories = loadCluesJson();
const bannedWords = loadBannedWords();

function defaultSettings() {
  return {
    categories: categories.map((c) => c.id),
    customCategories: [],
    imposterCount: 1,
    randomizeImposterCount: false,
    anonymousVoting: false,
    fraudNeverGoesFirst: false,
    timeLimitEnabled: false,
    timeLimitSeconds: 60,
  };
}

/**
 * In-memory authoritative state
 * - lobbies: Map<lobbyId, Lobby>
 * - lobbyByCode: Map<lobbyCode, lobbyId>
 */
const lobbies = new Map();
const lobbyByCode = new Map();

function publicLobbySummary(lobby) {
  return {
    id: lobby.lobbyId,
    name: lobby.lobbyName,
    playerCount: lobby.players.length,
    inGame: lobby.gameState.phase !== "lobby",
  };
}

function getLeaderboard(lobby) {
  return lobby.players
    .map((p) => ({ playerId: p.id, name: p.name, points: p.points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function ensureHost(lobby) {
  if (lobby.hostPlayerId && lobby.players.some((p) => p.id === lobby.hostPlayerId)) return;
  lobby.hostPlayerId = lobby.players[0]?.id ?? null;
}

function isHost(lobby, playerId) {
  return Boolean(playerId && lobby.hostPlayerId && lobby.hostPlayerId === playerId);
}

function createLobby({ lobbyName, isPrivate, settingsDefaults }) {
  const cleanedName = sanitizeName(lobbyName) || "Lobby";
  for (const bad of bannedWords) {
    if (cleanedName.toLowerCase().includes(bad)) {
      return { ok: false, error: "Lobby name contains banned word." };
    }
  }

  let code = makeLobbyCode();
  // avoid collisions
  while (lobbyByCode.has(code)) code = makeLobbyCode();

  const lobbyId = nanoid();
  const lobby = {
    lobbyId,
    lobbyCode: code,
    lobbyName: cleanedName,
    isPrivate: Boolean(isPrivate),
    hostPlayerId: null,
    settings: { ...defaultSettings(), ...(settingsDefaults ?? {}) },
    players: [],
    gameState: {
      phase: "lobby",
      roundId: null,
      categoryId: null,
      categoryName: null,
      clueBoard16: null,
      secretIndex: null,
      fraudIds: [],
      votesByVoterId: {},
      voteToStartVoterIds: new Set(),
      cluesByPlayerId: {},
      lastVoteResult: null,
      roundEnded: false,
      fraudGuess: null
    },
    chat: [],
  };

  lobbies.set(lobbyId, lobby);
  lobbyByCode.set(code, lobbyId);

  return { ok: true, lobbyId, lobbyCode: code };
}

function findLobbyByIdOrCode({ lobbyId, lobbyCode }) {
  if (lobbyId) return lobbies.get(lobbyId) ?? null;
  if (lobbyCode) {
    const id = lobbyByCode.get(String(lobbyCode).trim().toUpperCase());
    return id ? lobbies.get(id) ?? null : null;
  }
  return null;
}

function addOrReconnectPlayer({ lobby, playerName, clientPlayerId, socketId }) {
  const pid = String(clientPlayerId ?? "").trim();
  if (!pid) return { ok: false, error: "Missing clientPlayerId." };

  const name = sanitizeName(playerName) || "Player";
  let player = lobby.players.find((p) => p.id === pid);
  if (!player) {
    player = {
      id: pid,
      name,
      points: 0,
      joinedAt: now(),
      connected: true,
      socketId,
    };
    lobby.players.push(player);
  } else {
    player.name = name;
    player.connected = true;
    player.socketId = socketId;
  }
  ensureHost(lobby);
  return { ok: true, player };
}

function removePlayer({ lobby, playerId }) {
  const idx = lobby.players.findIndex((p) => p.id === playerId);
  if (idx === -1) return;
  lobby.players.splice(idx, 1);
  // cleanup per-round maps
  delete lobby.gameState.votesByVoterId[playerId];
  delete lobby.gameState.cluesByPlayerId[playerId];
  lobby.gameState.voteToStartVoterIds.delete(playerId);
  lobby.gameState.fraudIds = lobby.gameState.fraudIds.filter((id) => id !== playerId);
  ensureHost(lobby);
}

function setDisconnected({ lobby, playerId }) {
  const p = lobby.players.find((x) => x.id === playerId);
  if (!p) return;
  p.connected = false;
  p.socketId = null;
  ensureHost(lobby);
}

function startGameRound(lobby) {
  const selectedCategoryIds = Array.isArray(lobby.settings.categories) ? lobby.settings.categories : [];
  const available = categories.filter((c) => selectedCategoryIds.includes(c.id));
  const category = pickRandom(available.length ? available : categories);
  const board = pickRandom(category.boards);
  if (!board || !Array.isArray(board.clues16) || board.clues16.length !== 16) {
    throw new Error("Invalid clue board data (need 16).");
  }

  const roundId = nanoid();
  const secretIndex = Math.floor(Math.random() * 16);

  // fraud assignment
  const playerIds = lobby.players.map((p) => p.id);
  const minFrauds = 1;
  const maxFrauds = Math.max(1, Math.floor(playerIds.length / 2));
  let fraudCount = clampInt(lobby.settings.imposterCount, minFrauds, maxFrauds);
  if (lobby.settings.randomizeImposterCount) {
    fraudCount = clampInt(1 + Math.floor(Math.random() * maxFrauds), minFrauds, maxFrauds);
  }
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  const fraudIds = shuffled.slice(0, fraudCount);

  lobby.gameState.phase = "clues";
  lobby.gameState.roundId = roundId;
  lobby.gameState.categoryId = category.id;
  lobby.gameState.categoryName = category.name;
  lobby.gameState.clueBoard16 = board.clues16.slice();
  lobby.gameState.secretIndex = secretIndex;
  lobby.gameState.fraudIds = fraudIds;
  lobby.gameState.votesByVoterId = {};
  lobby.gameState.voteToStartVoterIds = new Set();
  lobby.gameState.cluesByPlayerId = {};
  lobby.gameState.lastVoteResult = null;
  lobby.gameState.roundEnded = false;
  lobby.gameState.fraudGuess = null;

  return {
    roundId,
    categoryName: category.name,
    clueBoard16: board.clues16.slice(),
    secretIndex,
    fraudIds: fraudIds.slice(),
  };
}

function computeVoteState(lobby) {
  const votesByVoterId = lobby.gameState.votesByVoterId ?? {};
  const voteCountsByTargetId = {};
  for (const [voterId, targetId] of Object.entries(votesByVoterId)) {
    if (!targetId) continue;
    voteCountsByTargetId[targetId] = (voteCountsByTargetId[targetId] ?? 0) + 1;
  }
  const eligibleVoters = lobby.players.length;
  const submittedCount = Object.keys(votesByVoterId).length;
  const allSubmittedBoolean = eligibleVoters > 0 && submittedCount >= eligibleVoters;
  return { votesByVoterId, voteCountsByTargetId, allSubmittedBoolean };
}

function resolveVoting(lobby) {
  const { voteCountsByTargetId } = computeVoteState(lobby);
  const totalVotes = Object.values(voteCountsByTargetId).reduce((a, b) => a + b, 0);

  let topTargetId = null;
  let topCount = 0;
  let tie = false;

  for (const [targetId, count] of Object.entries(voteCountsByTargetId)) {
    if (count > topCount) {
      topCount = count;
      topTargetId = targetId;
      tie = false;
    } else if (count === topCount && count > 0) {
      tie = true;
    }
  }

  const majorityVote = Boolean(topTargetId && !tie && totalVotes > 0 && topCount > totalVotes / 2);
  const eliminatedPlayerId = majorityVote ? topTargetId : undefined;
  const fraudEliminated = Boolean(eliminatedPlayerId && lobby.gameState.fraudIds.includes(eliminatedPlayerId));

  return { majorityVote, eliminatedPlayerId, fraudEliminated, voteCountsByTargetId, totalVotes };
}

function applyScoringAfterVote(lobby, { eliminatedPlayerId, fraudEliminated }) {
  // - Detectives eliminate The Fraud: +1 point each Detective
  // - Fraud survives a vote: +1 point each surviving Fraud
  const fraudIds = lobby.gameState.fraudIds.slice();
  const fraudSurvivedIds = eliminatedPlayerId ? fraudIds.filter((id) => id !== eliminatedPlayerId) : fraudIds;

  if (fraudEliminated) {
    // award detectives (non-frauds)
    for (const p of lobby.players) {
      if (!fraudIds.includes(p.id)) p.points += 1;
    }
  } else {
    // fraud survived voting -> surviving frauds get +1
    for (const p of lobby.players) {
      if (fraudSurvivedIds.includes(p.id)) p.points += 1;
    }
  }
}

function applyFraudGuess(lobby, guessIndex) {
  // Fraud guesses the secret word correctly: +1 bonus point (each surviving fraud)
  const secretIndex = lobby.gameState.secretIndex;
  const correct = guessIndex !== null && guessIndex === secretIndex;

  const eliminatedId = lobby.gameState.lastVoteResult?.eliminatedPlayerId;
  const fraudIds = lobby.gameState.fraudIds.slice();
  const survivingFraudIds = eliminatedId ? fraudIds.filter((id) => id !== eliminatedId) : fraudIds;

  if (correct) {
    for (const p of lobby.players) {
      if (survivingFraudIds.includes(p.id)) p.points += 1;
    }
  }

  return { correct };
}

function getWinnerIfAny(lobby, targetPoints = 10) {
  const best = lobby.players
    .map((p) => ({ playerId: p.id, name: p.name, points: p.points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))[0];
  if (!best) return null;
  return best.points >= targetPoints ? best : null;
}

function publicLobbyState(lobby, requestingPlayerId) {
  const gs = lobby.gameState;

  let cluesByPlayerId;
  if (gs.phase === "clues") {
    const own = gs.cluesByPlayerId?.[requestingPlayerId];
    cluesByPlayerId = own ? { [requestingPlayerId]: own } : {};
  } else if (gs.phase === "voting" || gs.phase === "fraud_guess" || gs.phase === "round_results") {
    cluesByPlayerId = { ...(gs.cluesByPlayerId ?? {}) };
  } else {
    cluesByPlayerId = {};
  }

  return {
    lobbyId: lobby.lobbyId,
    lobbyName: lobby.lobbyName,
    lobbyCode: lobby.lobbyCode,
    hostPlayerId: lobby.hostPlayerId,
    players: lobby.players.map((p) => ({
      id: p.id,
      name: p.name,
      points: p.points,
      joinedAt: p.joinedAt,
      connected: p.connected,
    })),
    settings: lobby.settings,
    gameState: {
      phase: gs.phase,
      roundId: gs.roundId,
      categoryName: gs.categoryName,
      cluesByPlayerId,
    },
  };
}

function getCategoryMeta() {
  return categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon }));
}

function getClueBoardForLobby(lobby) {
  return lobby.gameState.clueBoard16?.slice() ?? null;
}

function getCorrectWord(lobby) {
  const board = lobby.gameState.clueBoard16;
  const idx = lobby.gameState.secretIndex;
  if (!board || typeof idx !== "number") return null;
  return board[idx] ?? null;
}

module.exports = {
  lobbies,
  lobbyByCode,
  categories,
  defaultSettings,
  publicLobbySummary,
  publicLobbyState,
  getLeaderboard,
  getWinnerIfAny,
  sanitizeClue,
  sanitizeChat,
  sanitizeName,
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
};

