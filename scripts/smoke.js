/* eslint-disable no-console */
const { io } = require("socket.io-client");

const URL = process.env.URL || "http://localhost:8080";

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res));
  });
}

async function connectClient(name, clientPlayerId) {
  const socket = io(URL, { transports: ["websocket"] });
  await once(socket, "connect");
  return { socket, name, clientPlayerId };
}

async function main() {
  const a = await connectClient("Alice", "p-alice");
  const b = await connectClient("Bob", "p-bob");
  const c = await connectClient("Cara", "p-cara");

  const create = await emitAck(a.socket, "LOBBY_CREATE", { lobbyName: "Test Lobby", isPrivate: false });
  if (!create.ok) throw new Error(`create failed: ${create.error}`);

  const joinA = await emitAck(a.socket, "LOBBY_JOIN", {
    lobbyId: create.lobbyId,
    playerName: a.name,
    clientPlayerId: a.clientPlayerId,
  });
  const joinB = await emitAck(b.socket, "LOBBY_JOIN", {
    lobbyId: create.lobbyId,
    playerName: b.name,
    clientPlayerId: b.clientPlayerId,
  });
  const joinC = await emitAck(c.socket, "LOBBY_JOIN", {
    lobbyId: create.lobbyId,
    playerName: c.name,
    clientPlayerId: c.clientPlayerId,
  });
  if (!joinA.ok || !joinB.ok || !joinC.ok) throw new Error("join failed");

  const lobbyId = create.lobbyId;

  // --- Round 1: eliminate fraud in voting => should skip fraud_guess and go to ROUND_ENDED.
  let fraudPlayerIdRound1 = null;
  let roundEndedCount = 0;

  for (const cl of [a, b, c]) {
    cl.socket.on("ROUND_ENDED", () => {
      roundEndedCount += 1;
    });
  }

  a.socket.on("GAME_STARTED", (p) => {
    if (p.visibleSecretForPlayer === false) fraudPlayerIdRound1 = a.clientPlayerId;
  });
  b.socket.on("GAME_STARTED", (p) => {
    if (p.visibleSecretForPlayer === false) fraudPlayerIdRound1 = b.clientPlayerId;
  });
  c.socket.on("GAME_STARTED", (p) => {
    if (p.visibleSecretForPlayer === false) fraudPlayerIdRound1 = c.clientPlayerId;
  });

  const start1 = await emitAck(a.socket, "GAME_START", { lobbyId });
  if (!start1.ok) throw new Error(`GAME_START failed: ${start1.error}`);

  // wait for role assignment to land
  await new Promise((r) => setTimeout(r, 150));
  if (!fraudPlayerIdRound1) throw new Error("did not detect fraud in round 1");

  await emitAck(a.socket, "CLUE_SUBMIT", { lobbyId, clue: "alpha" });
  await emitAck(b.socket, "CLUE_SUBMIT", { lobbyId, clue: "bravo" });
  await emitAck(c.socket, "CLUE_SUBMIT", { lobbyId, clue: "charlie" });

  const votingStart1 = await emitAck(a.socket, "VOTING_START", { lobbyId });
  if (!votingStart1.ok) throw new Error(`VOTING_START failed: ${votingStart1.error}`);

  // Everyone votes for fraud => majority -> fraud eliminated.
  await emitAck(a.socket, "VOTE_SUBMIT", { lobbyId, targetPlayerId: fraudPlayerIdRound1 });
  await emitAck(b.socket, "VOTE_SUBMIT", { lobbyId, targetPlayerId: fraudPlayerIdRound1 });
  await emitAck(c.socket, "VOTE_SUBMIT", { lobbyId, targetPlayerId: fraudPlayerIdRound1 });

  // Wait for ROUND_ENDED to broadcast to all (3 clients -> 3 increments)
  await new Promise((r) => setTimeout(r, 250));
  if (roundEndedCount !== 3) throw new Error(`expected 3 ROUND_ENDED deliveries, got ${roundEndedCount}`);

  // --- Round 2: fraud survives voting => fraud_guess prompt only to fraud, then incorrect guess => ROUND_ENDED.
  let fraudPlayerIdRound2 = null;
  let fraudPromptCount = 0;
  let lastRoundEnded = null;

  for (const cl of [a, b, c]) {
    cl.socket.off("GAME_STARTED");
    cl.socket.off("FRAUD_GUESS_PROMPT");
    cl.socket.off("ROUND_ENDED");
  }

  for (const cl of [a, b, c]) {
    cl.socket.on("GAME_STARTED", (p) => {
      if (p.visibleSecretForPlayer === false) fraudPlayerIdRound2 = cl.clientPlayerId;
    });
    cl.socket.on("FRAUD_GUESS_PROMPT", () => {
      fraudPromptCount += 1;
    });
    cl.socket.on("ROUND_ENDED", (p) => {
      lastRoundEnded = p;
    });
  }

  const next = await emitAck(a.socket, "ROUND_NEXT", { lobbyId });
  if (!next.ok) throw new Error(`ROUND_NEXT failed: ${next.error}`);
  await new Promise((r) => setTimeout(r, 150));
  if (!fraudPlayerIdRound2) throw new Error("did not detect fraud in round 2");

  await emitAck(a.socket, "CLUE_SUBMIT", { lobbyId, clue: "delta" });
  await emitAck(b.socket, "CLUE_SUBMIT", { lobbyId, clue: "echo" });
  await emitAck(c.socket, "CLUE_SUBMIT", { lobbyId, clue: "foxtrot" });

  const votingStart2 = await emitAck(a.socket, "VOTING_START", { lobbyId });
  if (!votingStart2.ok) throw new Error(`VOTING_START2 failed: ${votingStart2.error}`);

  // Vote to eliminate a detective (first non-fraud we find)
  const detectiveTarget =
    fraudPlayerIdRound2 === a.clientPlayerId ? b.clientPlayerId : a.clientPlayerId;

  await emitAck(a.socket, "VOTE_SUBMIT", { lobbyId, targetPlayerId: detectiveTarget });
  await emitAck(b.socket, "VOTE_SUBMIT", { lobbyId, targetPlayerId: detectiveTarget });
  await emitAck(c.socket, "VOTE_SUBMIT", { lobbyId, targetPlayerId: detectiveTarget });

  await new Promise((r) => setTimeout(r, 200));
  if (fraudPromptCount !== 1) throw new Error(`expected FRAUD_GUESS_PROMPT to deliver once (fraud-only), got ${fraudPromptCount}`);

  // Fraud submits an incorrect guess: pick index 0 (can't guarantee wrong, but likely; if happens to be correct, still valid)
  const fraudClient = [a, b, c].find((x) => x.clientPlayerId === fraudPlayerIdRound2);
  const guess = await emitAck(fraudClient.socket, "FRAUD_GUESS", { lobbyId, guessIndex: 0 });
  if (!guess.ok) throw new Error(`FRAUD_GUESS failed: ${guess.error}`);

  await new Promise((r) => setTimeout(r, 200));
  if (!lastRoundEnded?.results) throw new Error("missing ROUND_ENDED payload");

  console.log("Smoke test passed. Key signals:", {
    round2FraudGuessCorrect: guess.correct,
    round2FraudWon: lastRoundEnded.results.fraudWon,
    round2FraudLost: lastRoundEnded.results.fraudLost,
    majorityVote: lastRoundEnded.results.majorityVote,
  });

  a.socket.disconnect();
  b.socket.disconnect();
  c.socket.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

