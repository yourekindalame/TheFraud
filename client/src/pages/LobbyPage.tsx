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
  const [passcodeDraft, setPasscodeDraft] = useState<string>(() => getLobbyPasscode(lobbyId) || "");
  const [joining, setJoining] = useState(false);

  const inThisLobby = store.lobbyState?.lobbyId === lobbyId;
  const lobby = inThisLobby ? store.lobbyState : null;
  const isHost = Boolean(lobby && lobby.hostPlayerId === store.clientPlayerId);
  const phase = lobby?.gameState?.phase || "lobby";

  useEffect(() => {
    if (!lobbyId) return;
    if (!store.playerName) return; // name gate
    if (inThisLobby) return;
    setJoining(true);
    socket.emit(
      "LOBBY_JOIN",
      {
        lobbyId,
        passcode: passcodeDraft.trim() ? passcodeDraft.trim() : undefined,
        playerName: store.playerName,
        clientPlayerId: store.clientPlayerId
      },
      (resp: { ok: boolean }) => {
        setJoining(false);
        if (!resp?.ok) return;
        if (passcodeDraft.trim()) setLobbyPasscode(lobbyId, passcodeDraft.trim());
      }
    );
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
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Joining lobby…</div>
        <div className="muted" style={{ marginBottom: 10 }}>
          Lobby Name: <strong>{lobbyId}</strong>
        </div>
        <label className="muted" style={{ fontSize: 12 }}>
          Passcode (if locked)
        </label>
        <input className="input" value={passcodeDraft} onChange={(e) => setPasscodeDraft(e.target.value)} placeholder="Try again if locked" />
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
                  lobbyId,
                  passcode: passcodeDraft.trim() ? passcodeDraft.trim() : undefined,
                  playerName: store.playerName,
                  clientPlayerId: store.clientPlayerId
                },
                (resp: { ok: boolean }) => {
                  setJoining(false);
                  if (resp?.ok && passcodeDraft.trim()) setLobbyPasscode(lobbyId, passcodeDraft.trim());
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
    <div className="grid2">
      <div className="panel panelPad">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>Lobby</div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="pill">
                <span className="muted">Lobby Name:</span>{" "}
                <strong>{revealCode ? lobby.lobbyId : "••••••"}</strong>
                <button className="btn" style={{ padding: "6px 10px", borderRadius: 999 }} onClick={() => setRevealCode((v) => !v)} aria-label="Reveal lobby code">
                  {revealCode ? "🙈" : "👁️"}
                </button>
              </span>
              <span className="pill">
                <span className="muted">Host:</span>{" "}
                <strong>{players.find((p) => p.id === lobby.hostPlayerId)?.name || "—"}</strong>
              </span>
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              Invite link:{" "}
              <span className="pill">
                <code>{`${window.location.origin}/lobby/${lobby.lobbyId}`}</code>
                <button
                  className="btn"
                  style={{ padding: "6px 10px", borderRadius: 999 }}
                  onClick={() => navigator.clipboard.writeText(`${window.location.origin}/lobby/${lobby.lobbyId}`)}
                >
                  Copy
                </button>
              </span>
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
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Leaderboard</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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

function LobbySetup({ lobbyId, isHost, players }: { lobbyId: string; isHost: boolean; players: PlayerPublic[] }) {
  const { store } = useApp();
  const socket = useMemo(() => getSocket(), []);

  const [imposterCount, setImposterCount] = useState<number>(store.lobbyState?.settings.imposterCount || 1);
  const [randomize, setRandomize] = useState<boolean>(store.lobbyState?.settings.randomizeImposterCount || false);
  const [newHostId, setNewHostId] = useState<string>("");

  useEffect(() => {
    setImposterCount(store.lobbyState?.settings.imposterCount || 1);
    setRandomize(store.lobbyState?.settings.randomizeImposterCount || false);
  }, [store.lobbyState?.settings.imposterCount, store.lobbyState?.settings.randomizeImposterCount]);

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Categories</div>
        <div className="muted" style={{ marginBottom: 10 }}>
          Big shiny buttons (future upsell). Only the host can select.
        </div>
        <div className="categoryGrid">
          {store.categories.map((c) => {
            const selected = store.lobbyState?.settings.category === c.id;
            return (
              <button
                key={c.id}
                className="categoryBtn"
                disabled={!isHost}
                onClick={() => socket.emit("SETTINGS_UPDATE", { lobbyId, partialSettings: { category: c.id } })}
                style={selected ? { outline: "2px solid rgba(34,197,94,0.65)" } : undefined}
              >
                <div className="categoryTitle">
                  {c.icon} {c.name}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {selected ? "Selected" : "Tap to select"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Host settings</div>
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
          <button className="btn btnPrimary" disabled={!isHost} onClick={() => socket.emit("GAME_START", { lobbyId })}>
            Start Game (works with 0+ players)
          </button>
        </div>
      </div>

      <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Players</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {players.map((p) => (
            <div key={p.id} className="panel panelPad" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
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
              Transfer host
            </div>
            <div className="row">
              <select className="input" style={{ flex: 1, minWidth: 220 }} value={newHostId} onChange={(e) => setNewHostId(e.target.value)}>
                <option value="">Select player…</option>
                {players
                  .filter((p) => p.id !== store.clientPlayerId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button
                className="btn"
                disabled={!newHostId}
                onClick={() => {
                  socket.emit("HOST_TRANSFER", { lobbyId, newHostPlayerId: newHostId });
                  setNewHostId("");
                }}
              >
                Transfer
              </button>
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
  const [chatDraft, setChatDraft] = useState("");
  const [fraudGuessIndex, setFraudGuessIndex] = useState<number | null>(null);

  const isDetective = started ? started.visibleSecretForPlayer : false;
  const secretIndex = started?.secretIndexIfAllowed;
  const clueBoard16 = started?.clueBoard16 || Array.from({ length: 16 }).map((_, i) => `Clue ${i + 1}`);

  const me = players.find((p) => p.id === store.clientPlayerId);
  const votedFor = store.voteState?.votesByVoterId?.[store.clientPlayerId] || "";

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
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

        <div style={{ marginTop: 12 }} className="board">
          {clueBoard16.map((c, i) => {
            const isSecret = isDetective && typeof secretIndex === "number" && i === secretIndex;
            const pickable = phase === "fraud_guess" && !isDetective;
            const picked = fraudGuessIndex === i;
            return (
              <div
                key={i}
                className={`tile ${isSecret ? "tileSecret" : ""} ${pickable ? "tilePickable" : ""}`}
                style={picked ? { outline: "2px solid rgba(239,68,68,0.75)" } : undefined}
                onClick={() => {
                  if (!pickable) return;
                  setFraudGuessIndex(i);
                }}
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
        <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Give clues (chat)</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            Detectives see the highlighted clue. Frauds don’t.
          </div>
          {isHost ? (
            <button className="btn btnPrimary" onClick={() => socket.emit("VOTING_START", { lobbyId })}>
              Begin Voting
            </button>
          ) : (
            <div className="muted">Waiting for the host to begin voting…</div>
          )}
        </div>
      )}

      {phase === "voting" && (
        <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 900, marginBottom: 4 }}>Voting</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Pick who you think is The Fraud.
              </div>
            </div>
            {isHost && (
              <HoldButton className="btn btnDanger" seconds={5} onConfirm={() => socket.emit("VOTING_END_EARLY", { lobbyId })}>
                End voting early (hold 5s)
              </HoldButton>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {players.map((p) => (
              <button
                key={p.id}
                className={`btn ${votedFor === p.id ? "btnPrimary" : ""}`}
                onClick={() => socket.emit("VOTE_SUBMIT", { lobbyId, targetPlayerId: p.id })}
              >
                Vote: {p.name}{" "}
                <span className="muted" style={{ marginLeft: 10 }}>
                  {store.voteState?.voteCountsByTargetId?.[p.id] ? `(${store.voteState.voteCountsByTargetId[p.id]})` : ""}
                </span>
              </button>
            ))}
          </div>

          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            {store.voteState?.allSubmittedBoolean ? "All votes submitted." : "Waiting for votes…"}
          </div>
        </div>
      )}

      {phase === "fraud_guess" && (
        <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Final Guess</div>
          {isDetective ? (
            <div className="muted">Detectives wait while The Fraud makes their final guess…</div>
          ) : (
            <>
              <div className="muted" style={{ marginBottom: 10 }}>
                Choose the secret clue from the board.
              </div>
              <div className="row">
                <button
                  className="btn btnPrimary"
                  disabled={fraudGuessIndex === null}
                  onClick={() => socket.emit("FRAUD_GUESS", { lobbyId, guessIndex: fraudGuessIndex })}
                >
                  Submit guess
                </button>
                <HoldButton className="btn btnDanger" seconds={5} onConfirm={() => socket.emit("FRAUD_GUESS", { lobbyId, guessIndex: null })}>
                  Skip (hold 5s)
                </HoldButton>
              </div>
            </>
          )}
        </div>
      )}

      <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Chat</div>
        <div className="chatLog">
          {store.chat.length === 0 ? <div className="muted">No messages yet.</div> : null}
          {store.chat.map((m) => (
            <div key={m.id} className="chatMsg">
              <div className="chatMeta">
                <span>
                  <strong>{m.fromName}</strong>
                </span>
                <span>{formatTime(m.at)}</span>
              </div>
              <div style={{ marginTop: 6 }}>{m.text}</div>
            </div>
          ))}
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <input className="input" value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Type a message…" />
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
    </div>
  );
}

