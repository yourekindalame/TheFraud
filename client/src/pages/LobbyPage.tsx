import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../AppContext";
import { getSocket } from "../lib/socket";
import { getLobbyPasscode, setLobbyPasscode } from "../lib/storage";
import type { PlayerPublic } from "../lib/types";
import { HoldButton } from "../components/HoldButton";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function LobbyPage() {
  const { lobbyId: lobbyIdParam } = useParams();
  const lobbyId = (lobbyIdParam || "").trim().toUpperCase();
  const { store } = useApp();
  const socket = useMemo(() => getSocket(), []);

  const [revealCode, setRevealCode] = useState(false);
  const [lobbyCodeDraft, setLobbyCodeDraft] = useState<string>(() => getLobbyPasscode(lobbyId) || lobbyId || "");
  const [joining, setJoining] = useState(false);

  const inThisLobby = store.lobbyState?.lobbyId === lobbyId;
  const lobby = inThisLobby ? store.lobbyState : null;
  const isHost = Boolean(lobby && lobby.hostPlayerId === store.clientPlayerId);
  const phase = lobby?.gameState?.phase || "lobby";

  useEffect(() => {
    if (!lobbyId) return;
    if (!store.playerName) return; // name gate
    if (inThisLobby) return;
    // Try joining by ID first (public lobby via invite link)
    // If it fails or requires code, user can enter code manually
    const storedCode = getLobbyPasscode(lobbyId);
    if (storedCode) {
      setLobbyCodeDraft(storedCode);
    }
    // Don't auto-join - let user click join button or enter code
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyId, store.playerName, store.clientPlayerId]);

  const players = lobby?.players || [];
  const leaderboard = store.leaderboard.length
    ? store.leaderboard
    : players
        .map((p) => ({ playerId: p.id, name: p.name, points: p.points }))
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  if (!lobbyId) {
    return (
      <div className="panel panelPad">
        <div style={{ fontWeight: 900 }}>Missing lobby id.</div>
        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn" to="/lobbies">
            Back
          </Link>
        </div>
      </div>
    );
  }

  if (!lobby) {
    return (
      <div className="panel panelPad">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Join Lobby</div>
        <div className="muted" style={{ marginBottom: 16 }}>
          {lobbyCodeDraft.trim() ? "Enter or verify the Lobby Code to join" : "Enter the Lobby Code to join this private lobby, or try joining from the public lobby list"}
        </div>
        <label className="muted" style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
          Lobby Code (required for private lobbies)
        </label>
        <input className="input" value={lobbyCodeDraft} onChange={(e) => setLobbyCodeDraft(e.target.value.toUpperCase())} placeholder="Enter lobby code (e.g. BAHM4T)" style={{ textTransform: "uppercase" }} />
        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn" to="/lobbies">
            Back
          </Link>
          <button
            className="btn btnPrimary"
            disabled={!store.playerName || joining}
            onClick={() => {
              if (!store.playerName) return;
              setJoining(true);
              socket.emit(
                "LOBBY_JOIN",
                {
                  lobbyId: lobbyId.toUpperCase(), // Try joining by ID first (public lobby)
                  ...(lobbyCodeDraft.trim() ? { lobbyCode: lobbyCodeDraft.trim().toUpperCase() } : {}), // Include code if provided
                  playerName: store.playerName,
                  clientPlayerId: store.clientPlayerId
                },
                (resp: { ok: boolean; lobbyId?: string }) => {
                  setJoining(false);
                  if (resp?.ok && resp.lobbyId && lobbyCodeDraft.trim()) {
                    setLobbyPasscode(resp.lobbyId, lobbyCodeDraft.trim().toUpperCase());
                  }
                }
              );
            }}
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid3">
      <ChatPanel lobbyId={lobby.lobbyId} players={players} />
      <div className="panel panelPad">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 24 }}>Lobby</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                <span className="pill">
                  <span className="muted">Lobby Name:</span>{" "}
                  <strong>{lobby.lobbyName || "Unnamed"}</strong>
                </span>
                <span className="pill">
                  <span className="muted">Host:</span>{" "}
                  <strong>{players.find((p) => p.id === lobby.hostPlayerId)?.name || "—"}</strong>
                </span>
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <span className="pill">
                  <span className="muted">Lobby Code:</span>{" "}
                  <strong>{revealCode ? (lobby.lobbyCode || "—") : "••••••"}</strong>
                </span>
                <button className="btn" style={{ padding: "6px 10px", borderRadius: 999 }} onClick={() => setRevealCode((v) => !v)} aria-label="Reveal lobby code">
                  {revealCode ? "🙈" : "👁️"}
                </button>
                {revealCode && lobby.lobbyCode && (
                  <button
                    className="btn"
                    style={{ padding: "6px 10px", borderRadius: 999 }}
                    onClick={() => navigator.clipboard.writeText(lobby.lobbyCode)}
                  >
                    Copy Code
                  </button>
                )}
              </div>
              {revealCode && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Share this code to invite players
                </div>
              )}
            </div>
          </div>

          <button
            className="btn"
            onClick={() => {
              socket.emit("LOBBY_LEAVE", { lobbyId: lobby.lobbyId });
            }}
          >
            Leave
          </button>
        </div>

        {phase === "lobby" ? (
          <LobbySetup lobbyId={lobby.lobbyId} isHost={isHost} players={players} />
        ) : (
          <GameView lobbyId={lobby.lobbyId} isHost={isHost} players={players} />
        )}
      </div>

      <div className="panel panelPad">
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 16 }}>Leaderboard</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {leaderboard.map((e) => (
            <div key={e.playerId} className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{e.name}</strong>
                  {e.playerId === lobby.hostPlayerId ? <span className="muted"> · Host</span> : null}
                </div>
                <div className="pill">
                  <strong>{e.points}</strong> <span className="muted">pts</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({ lobbyId, players }: { lobbyId: string; players: PlayerPublic[] }) {
  const { store } = useApp();
  const socket = useMemo(() => getSocket(), []);
  const [chatDraft, setChatDraft] = useState("");

  return (
    <div className="panel" style={{ background: "rgba(255,255,255,0.04)", padding: "12px" }}>
      <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 8 }}>Chat</div>
      <div className="chatLog">
        {store.chat.length === 0 ? <div className="muted">No messages yet.</div> : null}
        {store.chat.map((m) => {
          const player = players.find((p) => p.id === m.fromPlayerId);
          const playerProfileImage = player?.profileImage || null;
          return (
            <div key={m.id} className="chatMsg">
              <div className="chatMeta">
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {playerProfileImage ? (
                    <img
                      src={playerProfileImage}
                      alt={m.fromName}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        objectFit: "cover",
                        border: "1px solid var(--border)"
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid var(--border)",
                        flexShrink: 0
                      }}
                    >
                      <span style={{ color: "white", fontWeight: 700, fontSize: 12 }}>
                        {m.fromName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <strong>{m.fromName}</strong>
                </span>
                <span>{formatTime(m.at)}</span>
              </div>
              <div style={{ marginTop: 6 }}>{m.text}</div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Type a message…" onKeyDown={(e) => {
          if (e.key === "Enter") {
            const msg = chatDraft.trim();
            if (!msg) return;
            setChatDraft("");
            socket.emit("CHAT_SEND", { lobbyId, message: msg });
          }
        }} />
        <button
          className="btn btnSuccess"
          onClick={() => {
            const msg = chatDraft.trim();
            if (!msg) return;
            setChatDraft("");
            socket.emit("CHAT_SEND", { lobbyId, message: msg });
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function LobbySetup({ lobbyId, isHost, players }: { lobbyId: string; isHost: boolean; players: PlayerPublic[] }) {
  const { store } = useApp();
  const socket = useMemo(() => getSocket(), []);

  const [imposterCount, setImposterCount] = useState<number>(store.lobbyState?.settings.imposterCount || 1);
  const [randomize, setRandomize] = useState<boolean>(store.lobbyState?.settings.randomizeImposterCount || false);
  const [anonymousVoting, setAnonymousVoting] = useState<boolean>(store.lobbyState?.settings.anonymousVoting || false);
  const selectedCategories = store.lobbyState?.settings.categories || ["movies"];
  const customCategories = store.lobbyState?.settings.customCategories || [];

  useEffect(() => {
    setImposterCount(store.lobbyState?.settings.imposterCount || 1);
    setRandomize(store.lobbyState?.settings.randomizeImposterCount || false);
    setAnonymousVoting(store.lobbyState?.settings.anonymousVoting || false);
  }, [store.lobbyState?.settings.imposterCount, store.lobbyState?.settings.randomizeImposterCount, store.lobbyState?.settings.anonymousVoting]);

  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12 }}>Categories</div>
        <div className="muted" style={{ marginBottom: 16 }}>
          Select multiple categories (at least 1 required). Game randomly selects one each round.
        </div>
        <div className="categoryGrid">
          {store.categories.map((c) => {
            const selected = selectedCategories.includes(c.id);
            return (
              <label
                key={c.id}
                className={`categoryBtn ${selected ? "categoryBtnSelected" : ""} ${!isHost ? "categoryBtnDisabled" : ""}`}
                style={{
                  cursor: isHost ? "pointer" : "default"
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!isHost}
                  style={{ display: "none" }}
                  onChange={() => {
                    if (!isHost) return;
                    const newCategories = selected
                      ? selectedCategories.filter((id) => id !== c.id)
                      : [...selectedCategories, c.id];
                    if (newCategories.length === 0) return; // Must have at least 1
                    socket.emit("SETTINGS_UPDATE", { lobbyId, partialSettings: { categories: newCategories } });
                  }}
                />
                <div className="categoryTitle">
                  {c.icon} {c.name}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {selected ? "Selected" : "Click to select"}
                </div>
              </label>
            );
          })}
          {customCategories.map((c) => {
            const selected = selectedCategories.includes(c.id);
            return (
              <label
                key={c.id}
                className={`categoryBtn ${selected ? "categoryBtnSelected" : ""} ${!isHost ? "categoryBtnDisabled" : ""}`}
                style={{
                  cursor: isHost ? "pointer" : "default"
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!isHost}
                  style={{ display: "none" }}
                  onChange={() => {
                    if (!isHost) return;
                    const newCategories = selected
                      ? selectedCategories.filter((id) => id !== c.id)
                      : [...selectedCategories, c.id];
                    if (newCategories.length === 0) return; // Must have at least 1
                    socket.emit("SETTINGS_UPDATE", { lobbyId, partialSettings: { categories: newCategories } });
                  }}
                />
                <div className="categoryTitle">
                  {c.icon} {c.name}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {selected ? "Selected" : "Click to select"}
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 16 }}>Host settings</div>
        <div className="row">
          <div style={{ flex: 1, minWidth: 180 }}>
            <label className="muted" style={{ fontSize: 12 }}>
              Fraud count
            </label>
            <input
              className="input"
              type="number"
              min={1}
              max={Math.max(1, players.length - 1)}
              value={imposterCount}
              disabled={!isHost}
              onChange={(e) => setImposterCount(Number(e.target.value))}
              onBlur={() => isHost && socket.emit("SETTINGS_UPDATE", { lobbyId, partialSettings: { imposterCount } })}
            />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="muted" style={{ fontSize: 12 }}>
              Randomize fraud count
            </label>
            <select
              className="input"
              disabled={!isHost}
              value={randomize ? "yes" : "no"}
              onChange={(e) => {
                const v = e.target.value === "yes";
                setRandomize(v);
                if (isHost) socket.emit("SETTINGS_UPDATE", { lobbyId, partialSettings: { randomizeImposterCount: v } });
              }}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={anonymousVoting}
              disabled={!isHost}
              onChange={(e) => {
                const v = e.target.checked;
                setAnonymousVoting(v);
                if (isHost) socket.emit("SETTINGS_UPDATE", { lobbyId, partialSettings: { anonymousVoting: v } });
              }}
            />
            Anonymous voting (hide player names during voting)
          </label>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btnPrimary" disabled={!isHost} onClick={() => socket.emit("GAME_START", { lobbyId })}>
            Start Game (works with 0+ players)
          </button>
        </div>
      </div>

      <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 16 }}>Players</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {players.map((p) => (
            <div key={p.id} className="panel panelPad" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div
                  style={{
                    cursor: isHost && p.id !== store.clientPlayerId ? "pointer" : "default",
                    textDecoration: isHost && p.id !== store.clientPlayerId ? "underline" : "none"
                  }}
                  onClick={() => {
                    if (isHost && p.id !== store.clientPlayerId) {
                      socket.emit("HOST_TRANSFER", { lobbyId, newHostPlayerId: p.id });
                    }
                  }}
                >
                  <strong>{p.name}</strong> <span className="muted">· {p.connected ? "online" : "offline"}</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {formatTime(p.joinedAt)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {isHost && players.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Click a player name to transfer host
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GameView({ lobbyId, isHost, players }: { lobbyId: string; isHost: boolean; players: PlayerPublic[] }) {
  const { store } = useApp();
  const socket = useMemo(() => getSocket(), []);
  const phase = store.lobbyState?.gameState?.phase || "clues";

  const started = store.gameStarted;
  const [fraudGuessIndex, setFraudGuessIndex] = useState<number | null>(null);
  const [selectedVoteTarget, setSelectedVoteTarget] = useState<string | null>(null);
  const [clueDraft, setClueDraft] = useState("");
  const [roleRevealState, setRoleRevealState] = useState<"hidden" | "stepB" | "revealed">("hidden");
  const [roleRevealCountdown, setRoleRevealCountdown] = useState(3);
  const [stepACountdown, setStepACountdown] = useState(3);
  const [fraudGuessTimer, setFraudGuessTimer] = useState<number>(60);
  const [fraudGuessResult, setFraudGuessResult] = useState<{ isCorrect: boolean; guessIndex: number | null; secretIndex: number } | null>(null);
  const [nextRoundCountdown, setNextRoundCountdown] = useState<number>(10);

  const isDetective = started ? started.visibleSecretForPlayer : false;
  const secretIndex = started?.secretIndexIfAllowed;
  const clueBoard16 = started?.clueBoard16 || Array.from({ length: 16 }).map((_, i) => `Clue ${i + 1}`);

  const me = players.find((p) => p.id === store.clientPlayerId);
  const votedFor = store.voteState?.votesByVoterId?.[store.clientPlayerId] || "";
  const anonymousVoting = store.lobbyState?.settings.anonymousVoting || false;

  // Reset role reveal when round changes
  useEffect(() => {
    if (started?.roundId) {
      setRoleRevealState("hidden");
      setRoleRevealCountdown(3);
      setStepACountdown(3);
    }
  }, [started?.roundId]);

  // Sync clue draft with saved clue when it changes
  useEffect(() => {
    const savedClue = store.lobbyState?.gameState?.cluesByPlayerId?.[store.clientPlayerId];
    if (savedClue && !clueDraft) {
      setClueDraft(savedClue);
    }
  }, [store.lobbyState?.gameState?.cluesByPlayerId, store.clientPlayerId]);

  // Reset fraud guess index and timer when phase changes
  useEffect(() => {
    if (phase === "fraud_guess" && !isDetective) {
      // Start 1-minute timer when fraud guess phase starts
      setFraudGuessTimer(60);
      setFraudGuessResult(null);
      setNextRoundCountdown(10);
    } else if (phase !== "fraud_guess") {
      setFraudGuessIndex(null);
      setFraudGuessTimer(60);
      setFraudGuessResult(null);
      setNextRoundCountdown(10);
    }
  }, [phase, isDetective]);

  // Fraud guess 1-minute timer
  useEffect(() => {
    if (phase === "fraud_guess" && !isDetective && fraudGuessTimer > 0 && !fraudGuessResult) {
      const timer = setTimeout(() => {
        setFraudGuessTimer((prev) => {
          const next = prev - 1;
          if (next === 0) {
            // Timer expired - auto-submit null guess
            socket.emit("FRAUD_GUESS", { lobbyId, guessIndex: null });
          }
          return next;
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [phase, isDetective, fraudGuessTimer, fraudGuessResult, socket, lobbyId]);

  // Listen for FRAUD_GUESS_RESULT
  useEffect(() => {
    const onFraudGuessResult = (payload: { lobbyId: string; isCorrect: boolean; guessIndex: number | null; secretIndex: number }) => {
      if (payload.lobbyId === lobbyId) {
        setFraudGuessResult({ isCorrect: payload.isCorrect, guessIndex: payload.guessIndex, secretIndex: payload.secretIndex });
        setNextRoundCountdown(10); // Start 10-second countdown
      }
    };
    socket.on("FRAUD_GUESS_RESULT", onFraudGuessResult);
    return () => {
      socket.off("FRAUD_GUESS_RESULT", onFraudGuessResult);
    };
  }, [socket, lobbyId]);

  // Next round countdown timer (10 seconds)
  useEffect(() => {
    if (fraudGuessResult && nextRoundCountdown > 0) {
      const timer = setTimeout(() => {
        setNextRoundCountdown((prev) => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [fraudGuessResult, nextRoundCountdown]);

  // Step A countdown: Automatically count down 3 seconds from "hidden" state, then proceed to Step B
  useEffect(() => {
    if (roleRevealState === "hidden" && started && stepACountdown > 0) {
      const timer = setTimeout(() => {
        const next = stepACountdown - 1;
        setStepACountdown(next);
        if (next === 0) {
          setRoleRevealState("stepB");
          setRoleRevealCountdown(3);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [roleRevealState, stepACountdown, started]);

  // Step B countdown: Role reveal modal auto-closes after 3 seconds
  useEffect(() => {
    if (roleRevealState === "stepB" && roleRevealCountdown > 0) {
      const timer = setTimeout(() => {
        const next = roleRevealCountdown - 1;
        setRoleRevealCountdown(next);
        if (next === 0) {
          setRoleRevealState("revealed");
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [roleRevealState, roleRevealCountdown]);

  // Show role reveal Step A: "Ready to see your role?" with automatic countdown
  if (started && roleRevealState === "hidden") {
    return (
      <div className="modalBackdrop" role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 100 }}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="modalHeader">
            <h2 style={{ margin: 0 }}>Ready to see your role?</h2>
          </div>
          <div className="modalBody">
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 64, marginBottom: 16, color: "rgba(124, 58, 237, 0.8)" }}>👁️</div>
              <div className="muted" style={{ fontSize: 16, marginBottom: 24 }}>
                {stepACountdown > 0 ? `Revealing in ${stepACountdown}...` : "Revealing..."}
              </div>
              <button
                className="btn btnPrimary"
                style={{ width: "100%", padding: "16px 24px", fontSize: 18 }}
                onClick={() => {
                  setRoleRevealState("stepB");
                  setRoleRevealCountdown(3);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show role reveal Step B: Role reveal modal
  if (started && roleRevealState === "stepB") {
    return (
      <div className="modalBackdrop" role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 100 }}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="modalHeader">
            <h2 style={{ margin: 0, background: "linear-gradient(135deg, var(--accent-pink), var(--accent))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              {isDetective ? "You are a Detective!" : "You are THE FRAUD!"}
            </h2>
          </div>
          <div className="modalBody">
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>{isDetective ? "🕵️" : "🎭"}</div>
              <div className="muted" style={{ fontSize: 16, marginBottom: 24, lineHeight: 1.6 }}>
                {isDetective
                  ? "You know the secret word. Give a clear one-word clue and find The Fraud."
                  : "Blend in with the others. You don't know the secret word — figure it out from their clues!"}
              </div>
              <button
                className="btn btnPrimary"
                style={{ width: "100%", padding: "16px 24px", fontSize: 18, background: "linear-gradient(135deg, var(--accent-pink), var(--accent))" }}
                onClick={() => {
                  setRoleRevealState("revealed");
                }}
              >
                {roleRevealCountdown > 0 ? `Continue (${roleRevealCountdown})` : "Continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>{started?.category || "Round"}</div>
            <div className="muted">
              You are: <strong>{isDetective ? "Detective" : "Fraud"}</strong>
              {me ? <span className="muted"> · playing as {me.name}</span> : null}
            </div>
          </div>
          {isHost && (
            <HoldButton className="btn btnDanger" seconds={5} onConfirm={() => socket.emit("ROUND_END", { lobbyId })}>
              End round (hold 5s)
            </HoldButton>
          )}
        </div>

        <div style={{ marginTop: 20 }} className="board">
          {clueBoard16.map((c, i) => {
            // Only show secret highlight if role is revealed
            const isSecret = isDetective && roleRevealState === "revealed" && typeof secretIndex === "number" && i === secretIndex;
            // Make tiles clickable for fraud guess phase
            const isFraudGuessPhase = phase === "fraud_guess" && !isDetective;
            const isSelected = isFraudGuessPhase && fraudGuessIndex === i;
            return (
              <div
                key={i}
                className={`tile ${isSecret ? "tileSecret" : ""}`}
                style={
                  isSelected
                    ? {
                        outline: "2px solid rgba(124, 58, 237, 0.75)",
                        background: "rgba(124, 58, 237, 0.2)",
                        cursor: "pointer"
                      }
                    : isFraudGuessPhase
                      ? { cursor: "pointer" }
                      : undefined
                }
                onClick={isFraudGuessPhase ? () => setFraudGuessIndex(i) : undefined}
              >
                <div>
                  <div style={{ fontWeight: 800 }}>{c}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {phase === "clues" && (
        <>
          <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 20 }}>💡</span>
              <div style={{ fontWeight: 900, fontSize: 20 }}>Your Clue</div>
            </div>
            <div className="muted" style={{ marginBottom: 16, fontSize: 14 }}>
              Write a one-word clue to help identify the secret word
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={clueDraft || store.lobbyState?.gameState?.cluesByPlayerId?.[store.clientPlayerId] || ""}
                onChange={(e) => setClueDraft(e.target.value.trim().split(/\s+/)[0] || "")}
                placeholder="One word clue"
                maxLength={20}
              />
              <button
                className="btn btnPrimary"
                disabled={!clueDraft.trim() && !store.lobbyState?.gameState?.cluesByPlayerId?.[store.clientPlayerId]}
                onClick={() => {
                  const clueToSubmit = clueDraft.trim() || store.lobbyState?.gameState?.cluesByPlayerId?.[store.clientPlayerId] || "";
                  if (!clueToSubmit) return;
                  socket.emit("CLUE_SUBMIT", { lobbyId, clue: clueToSubmit });
                  setClueDraft("");
                }}
                style={{ minWidth: "auto", padding: "12px 16px" }}
              >
                ✓
              </button>
            </div>
          </div>

          <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 20 }}>💬</span>
              <div style={{ fontWeight: 900, fontSize: 20 }}>Player Clues</div>
            </div>
            <div className="muted" style={{ marginBottom: 16, fontSize: 14 }}>
              Clues submitted by all players
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {players.map((p) => {
                const playerClue = store.lobbyState?.gameState?.cluesByPlayerId?.[p.id];
                const isCurrentPlayer = p.id === store.clientPlayerId;
                return (
                  <div
                    key={p.id}
                    style={{
                      padding: "12px 16px",
                      borderRadius: 8,
                      background: isCurrentPlayer ? "rgba(168, 85, 247, 0.2)" : "rgba(30, 41, 59, 0.3)",
                      border: `1px solid ${isCurrentPlayer ? "rgba(168, 85, 247, 0.4)" : "var(--border)"}`,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong>{p.name}</strong>
                      {isCurrentPlayer && <span className="muted" style={{ fontSize: 12 }}>(You)</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {playerClue ? (
                        <>
                          <span>{playerClue}</span>
                          <span style={{ fontSize: 16, color: "var(--accent2)" }}>✓</span>
                        </>
                      ) : (
                        <>
                          <span className="muted" style={{ fontSize: 14 }}>No clue yet</span>
                          <span className="muted" style={{ fontSize: 14 }}>🕐</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className="muted" style={{ marginBottom: 10, fontSize: 14 }}>
              Detectives see the highlighted clue. Frauds don't.
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btnPrimary" onClick={() => socket.emit("VOTE_TO_START_VOTING", { lobbyId })}>
                Vote to Start Voting
              </button>
              <div className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center" }}>
                {store.voteState?.voteToStartCount || 0} / {store.voteState?.voteToStartRequired || Math.ceil(players.length * 0.5)} votes
              </div>
            </div>
          </div>
        </>
      )}

      {(phase === "voting" || phase === "fraud_guess") && (
        <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>💬</span>
            <div style={{ fontWeight: 900, fontSize: 20 }}>Player Clues</div>
          </div>
          <div className="muted" style={{ marginBottom: 16, fontSize: 14 }}>
            All clues submitted by players
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {players.map((p) => {
              const playerClue = store.lobbyState?.gameState?.cluesByPlayerId?.[p.id];
              const isCurrentPlayer = p.id === store.clientPlayerId;
              return (
                <div
                  key={p.id}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 8,
                    background: isCurrentPlayer ? "rgba(168, 85, 247, 0.2)" : "rgba(30, 41, 59, 0.3)",
                    border: `1px solid ${isCurrentPlayer ? "rgba(168, 85, 247, 0.4)" : "var(--border)"}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong>{p.name}</strong>
                    {isCurrentPlayer && <span className="muted" style={{ fontSize: 12 }}>(You)</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {playerClue ? (
                      <>
                        <span>{playerClue}</span>
                        <span style={{ fontSize: 16, color: "var(--accent2)" }}>✓</span>
                      </>
                    ) : (
                      <span className="muted" style={{ fontSize: 14 }}>No clue</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {phase === "voting" && (
        <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 8 }}>Voting</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Click a player to vote for them.
              </div>
            </div>
            {isHost && (
              <HoldButton className="btn btnDanger" seconds={3} onConfirm={() => socket.emit("VOTING_END_EARLY", { lobbyId })}>
                End voting early (hold 3s)
              </HoldButton>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {players.map((p) => {
              const voteCount = store.voteState?.voteCountsByTargetId?.[p.id] || 0;
              const voterIds = anonymousVoting
                ? []
                : Object.entries(store.voteState?.votesByVoterId || {})
                    .filter(([, targetId]) => targetId === p.id)
                    .map(([voterId]) => voterId);
              const voters = voterIds.map((voterId) => players.find((pl) => pl.id === voterId)).filter(Boolean);
              const hasVoted = votedFor === p.id;
              return (
                <button
                  key={p.id}
                  className="btn"
                  style={{
                    textAlign: "left",
                    padding: "16px",
                    background: hasVoted ? "rgba(124, 58, 237, 0.2)" : "rgba(255,255,255,0.03)",
                    borderColor: hasVoted ? "rgba(124, 58, 237, 0.5)" : "rgba(255,255,255,0.08)",
                    justifyContent: "space-between",
                    display: "flex",
                    alignItems: "center"
                  }}
                  disabled={!!votedFor}
                  onClick={() => {
                    if (!votedFor) {
                      socket.emit("VOTE_SUBMIT", { lobbyId, targetPlayerId: p.id });
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong>{p.name}</strong>
                    {voters.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {voters.map((voter) => (
                          <span key={voter?.id || ""} style={{ fontSize: 16 }} title={voter?.name}>
                            {voter?.name?.charAt(0).toUpperCase() || ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="pill">
                    <strong>{voteCount}</strong> <span className="muted">vote{voteCount !== 1 ? "s" : ""}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
            {store.voteState?.allSubmittedBoolean ? "All votes submitted." : votedFor ? "Your vote has been submitted." : "Click a player to vote for them."}
          </div>
        </div>
      )}

      {phase === "fraud_guess" && !isDetective && !fraudGuessResult && (
        <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20 }}>🎯</span>
              <div style={{ fontWeight: 900, fontSize: 20 }}>Guess the Secret Word</div>
            </div>
            <div className="pill" style={{ fontSize: 18, fontWeight: 700, color: fraudGuessTimer <= 10 ? "var(--danger)" : "inherit" }}>
              {Math.floor(fraudGuessTimer / 60)}:{(fraudGuessTimer % 60).toString().padStart(2, "0")}
            </div>
          </div>
          <div className="muted" style={{ marginBottom: 16, fontSize: 14 }}>
            You survived! Click a word above to guess the secret word for a bonus point. Time limit: 1 minute.
          </div>
          <div className="row" style={{ gap: 12 }}>
            <button
              className="btn btnPrimary"
              style={{ flex: 1, padding: "16px 24px", fontSize: 18, background: "var(--warning-yellow)", color: "white", fontWeight: 700, border: "none" }}
              disabled={fraudGuessIndex === null}
              onClick={() => {
                socket.emit("FRAUD_GUESS", { lobbyId, guessIndex: fraudGuessIndex });
                setFraudGuessIndex(null);
              }}
            >
              Submit Guess
            </button>
            <div style={{ flex: 1 }}>
              <HoldButton
                className="btn"
                seconds={3}
                onConfirm={() => {
                  socket.emit("FRAUD_GUESS", { lobbyId, guessIndex: null });
                  setFraudGuessIndex(null);
                }}
              >
                Skip
              </HoldButton>
            </div>
          </div>
        </div>
      )}

      {fraudGuessResult && (
        <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12 }}>
            {fraudGuessResult.isCorrect ? "✅ The Fraud Guessed Correctly!" : "❌ The Fraud Guessed Incorrectly"}
          </div>
          <div className="muted" style={{ marginBottom: 8 }}>
            {fraudGuessResult.guessIndex !== null
              ? `The Fraud guessed: "${clueBoard16[fraudGuessResult.guessIndex]}"`
              : "The Fraud did not guess"}
          </div>
          <div className="muted" style={{ marginBottom: 16 }}>
            The secret word was: <strong>{clueBoard16[fraudGuessResult.secretIndex]}</strong>
          </div>
          <div className="muted" style={{ fontSize: 14 }}>
            Next round starting in {nextRoundCountdown} {nextRoundCountdown === 1 ? "second" : "seconds"}...
          </div>
        </div>
      )}

      {phase === "fraud_guess" && isDetective && !fraudGuessResult && (
        <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12 }}>Final Guess</div>
          <div className="muted">Detectives wait while The Fraud makes their final guess…</div>
        </div>
      )}

    </div>
  );
}

