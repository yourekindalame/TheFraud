const { nanoid, customAlphabet } = require("nanoid");
const bcrypt = require("bcryptjs");
const fs = require("node:fs");
const path = require("node:path");

const LOBBY_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I

function createLobbyId() {
  // nanoid custom alphabet -> 6 chars
  const gen = customAlphabet(LOBBY_ID_ALPHABET, 6);
  return gen();
}

function now() {
  return Date.now();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeName(name) {
  return String(name ?? "").trim().slice(0, 24);
}

function safeMessage(message) {
  return String(message ?? "").trim().slice(0, 280);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function readBannedWords() {
  const filePath = path.join(__dirname, "..", "data", "banned-words.txt");
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((w) => w.toLowerCase());
}

const BANNED_WORDS = readBannedWords();

function validateLobbyName(lobbyName) {
  const name = safeName(lobbyName);
  if (name.length < 3) return { ok: false, message: "Lobby name must be at least 3 characters." };
  if (name.length > 24) return { ok: false, message: "Lobby name is too long." };
  const lower = name.toLowerCase();
  for (const bad of BANNED_WORDS) {
    if (bad && lower.includes(bad)) return { ok: false, message: "Lobby name contains a banned word." };
  }
  return { ok: true, value: name };
}

function defaultSettings() {
  return {
    categories: ["movies"],
    customCategories: [],
    imposterCount: 1,
    randomizeImposterCount: false,
    anonymousVoting: false,
    fraudNeverGoesFirst: false,
    timeLimitEnabled: false,
    timeLimitSeconds: 60
  };
}

function publicLobbySummary(lobby) {
  return {
    lobbyId: lobby.lobbyId,
    lobbyName: lobby.lobbyName,
    locked: Boolean(lobby.passcodeHash),
    playerCount: lobby.players.length,
    inGame: lobby.gameState.phase !== "lobby"
  };
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    points: p.points,
    joinedAt: p.joinedAt,
    connected: p.connected
  };
}

function publicLobbyState(lobby) {
  return {
    lobbyId: lobby.lobbyId,
    hostPlayerId: lobby.hostPlayerId,
    players: lobby.players.map(publicPlayer).sort((a, b) => a.joinedAt - b.joinedAt),
    settings: lobby.settings,
    gameState: {
      phase: lobby.gameState?.phase || "lobby",
      roundId: lobby.gameState?.roundId || null,
      categoryName: lobby.gameState?.categoryName || null
    }
  };
}

function ensureHostValid(lobby) {
  const host = lobby.players.find((p) => p.id === lobby.hostPlayerId);
  if (host) return host;
  const candidates = lobby.players.slice().sort((a, b) => a.joinedAt - b.joinedAt);
  const newHost = candidates[0] || null;
  lobby.hostPlayerId = newHost ? newHost.id : null;
  return newHost;
}

function chooseFrauds(lobby) {
  const connectedPlayers = lobby.players.filter((p) => p.connected);
  const ids = connectedPlayers.map((p) => p.id);
  const shuffled = shuffle(ids);

  let count = clamp(Number(lobby.settings.imposterCount || 1), 1, Math.max(1, ids.length - 1));
  if (lobby.settings.randomizeImposterCount) {
    const max = Math.max(1, Math.min(3, ids.length - 1));
    count = 1 + Math.floor(Math.random() * max);
  }
  return new Set(shuffled.slice(0, count));
}

function loadClues() {
  const filePath = path.join(__dirname, "..", "data", "clues.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const CLUES = loadClues();

function getCategoryById(categoryId) {
  return CLUES.categories.find((c) => c.id === categoryId) || null;
}

function getAllCategories() {
  return CLUES.categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon }));
}

function startGameRound(lobby) {
  // Support multiple categories - randomly select one
  const selectedCategoryIds = lobby.settings.categories || [];
  if (selectedCategoryIds.length === 0) {
    selectedCategoryIds.push("movies"); // fallback
  }
  
  // Try to pick from selected categories (mix of built-in and custom)
  let category = null;
  const allCategoryIds = [...selectedCategoryIds];
  
  // Pick a random category ID
  const selectedId = pickRandom(allCategoryIds);
  
  // First try built-in categories
  category = getCategoryById(selectedId);
  
  // If not found, try custom categories
  if (!category && lobby.settings.customCategories) {
    const custom = lobby.settings.customCategories.find((c) => c.id === selectedId);
    if (custom) {
      category = custom;
    }
  }
  
  // Fallback to first built-in category if nothing found
  if (!category) {
    category = CLUES.categories[0];
  }
  
  const board = pickRandom(category.boards);
  const clueBoard16 = board.clues16;
  const secretIndex = Math.floor(Math.random() * 16);
  const fraudIds = chooseFrauds(lobby);

  lobby.gameState = {
    phase: "clues",
    roundId: nanoid(8),
    categoryId: category.id,
    categoryName: category.name,
    clueBoard16,
    secretIndex,
    fraudIds: [...fraudIds],
    votesByVoterId: {},
    voteToStartVoterIds: new Set(),
    lastVoteResult: null
  };

  return lobby.gameState;
}

function computeVoteState(lobby) {
  const votesByVoterId = lobby.gameState.votesByVoterId || {};
  const voteCountsByTargetId = {};
  for (const targetId of Object.values(votesByVoterId)) {
    if (!targetId) continue;
    voteCountsByTargetId[targetId] = (voteCountsByTargetId[targetId] || 0) + 1;
  }
  const connectedIds = lobby.players.filter((p) => p.connected).map((p) => p.id);
  const allSubmittedBoolean = connectedIds.every((id) => Boolean(votesByVoterId[id]));

  return { votesByVoterId, voteCountsByTargetId, allSubmittedBoolean };
}

function resolveVoting(lobby) {
  const { voteCountsByTargetId } = computeVoteState(lobby);
  const entries = Object.entries(voteCountsByTargetId);
  if (entries.length === 0) {
    return { eliminatedPlayerId: null, fraudEliminated: false };
  }
  entries.sort((a, b) => b[1] - a[1]);
  const topCount = entries[0][1];
  const tied = entries.filter(([, c]) => c === topCount).map(([id]) => id);
  const eliminatedPlayerId = pickRandom(tied);
  const fraudEliminated = (lobby.gameState.fraudIds || []).includes(eliminatedPlayerId);
  return { eliminatedPlayerId, fraudEliminated };
}

function applyScoringAfterVote(lobby, { eliminatedPlayerId, fraudEliminated }) {
  const fraudIds = new Set(lobby.gameState.fraudIds || []);
  const playersById = new Map(lobby.players.map((p) => [p.id, p]));

  if (!eliminatedPlayerId) {
    return { summary: "No votes were cast.", fraudEliminated: false };
  }

  if (fraudEliminated) {
    // Detectives eliminate The Fraud: +1 point each (non-fraud connected)
    for (const p of lobby.players) {
      if (!p.connected) continue;
      if (fraudIds.has(p.id)) continue;
      p.points += 1;
    }
    return { summary: "Detectives eliminated The Fraud. +1 point each for Detectives.", fraudEliminated: true };
  }

  // Fraud survives a vote: +1 point each surviving fraud
  for (const fraudId of fraudIds) {
    const fp = playersById.get(fraudId);
    if (fp && fp.connected) fp.points += 1;
  }
  return { summary: "The Fraud survived the vote. +1 point for each Fraud.", fraudEliminated: false };
}

function applyFraudGuess(lobby, guessIndex) {
  const fraudIds = new Set(lobby.gameState.fraudIds || []);
  const playersById = new Map(lobby.players.map((p) => [p.id, p]));
  const correct = typeof guessIndex === "number" && guessIndex === lobby.gameState.secretIndex;
  if (correct) {
    for (const fraudId of fraudIds) {
      const fp = playersById.get(fraudId);
      if (fp && fp.connected) fp.points += 1; // bonus point
    }
  }
  return { correct };
}

function getLeaderboard(lobby) {
  return lobby.players
    .map((p) => ({ playerId: p.id, name: p.name, points: p.points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function createLobby({ lobbyName, passcode, settingsDefaults }) {
  const nameCheck = validateLobbyName(lobbyName);
  if (!nameCheck.ok) {
    return { ok: false, error: nameCheck.message };
  }

  const lobbyId = createLobbyId();
  const passcodeHash = passcode ? bcrypt.hashSync(String(passcode), 10) : null;
  const settings = { ...defaultSettings(), ...(settingsDefaults || {}) };

  return {
    ok: true,
    lobby: {
      lobbyId,
      lobbyName: nameCheck.value,
      passcodeHash,
      hostPlayerId: null,
      settings,
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
        lastVoteResult: null
      }
    }
  };
}

function addOrUpdatePlayer(lobby, { clientPlayerId, playerName, socketId }) {
  const id = String(clientPlayerId || "").trim();
  if (!id) return { ok: false, error: "Missing clientPlayerId." };
  const name = safeName(playerName);
  if (!name) return { ok: false, error: "Missing player name." };

  const existing = lobby.players.find((p) => p.id === id);
  if (existing) {
    existing.name = name; // keep updated
    existing.socketId = socketId;
    existing.connected = true;
    return { ok: true, player: existing, isNew: false };
  }

  const player = {
    id,
    name,
    points: 0,
    joinedAt: now(),
    connected: true,
    socketId
  };
  lobby.players.push(player);
  return { ok: true, player, isNew: true };
}

function removePlayer(lobby, playerId) {
  const idx = lobby.players.findIndex((p) => p.id === playerId);
  if (idx === -1) return false;
  lobby.players.splice(idx, 1);
  return true;
}

module.exports = {
  BANNED_WORDS,
  CLUES,
  getAllCategories,
  getCategoryById,
  publicLobbySummary,
  publicLobbyState,
  ensureHostValid,
  createLobby,
  addOrUpdatePlayer,
  removePlayer,
  safeMessage,
  safeName,
  startGameRound,
  computeVoteState,
  resolveVoting,
  applyScoringAfterVote,
  applyFraudGuess,
  getLeaderboard,
  defaultSettings
};

