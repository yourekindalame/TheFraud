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
            {revealCode && (
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
            )}
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
  const [anonymousVoting, setAnonymousVoting] = useState<boolean>(store.lobbyState?.settings.anonymousVoting || false);
  const [newCustomCategoryName, setNewCustomCategoryName] = useState<string>("");
  const [newCustomCategoryIcon, setNewCustomCategoryIcon] = useState<string>("🎯");

  const selectedCategories = store.lobbyState?.settings.categories || ["movies"];
  const customCategories = store.lobbyState?.settings.customCategories || [];

  useEffect(() => {
    setImposterCount(store.lobbyState?.settings.imposterCount || 1);
    setRandomize(store.lobbyState?.settings.randomizeImposterCount || false);
    setAnonymousVoting(store.lobbyState?.settings.anonymousVoting || false);
  }, [store.lobbyState?.settings.imposterCount, store.lobbyState?.settings.randomizeImposterCount, store.lobbyState?.settings.anonymousVoting]);

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Categories</div>
        <div className="muted" style={{ marginBottom: 10 }}>
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
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Create custom category (you'll need to provide 16 clues)
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Category name"
              value={newCustomCategoryName}
              disabled={!isHost}
              onChange={(e) => setNewCustomCategoryName(e.target.value)}
            />
            <input
              className="input"
              style={{ width: 60 }}
              placeholder="🎯"
              value={newCustomCategoryIcon}
              disabled={!isHost}
              onChange={(e) => setNewCustomCategoryIcon(e.target.value)}
            />
            <button
              className="btn"
              disabled={!isHost || !newCustomCategoryName.trim()}
              onClick={() => {
                if (!isHost || !newCustomCategoryName.trim()) return;
                const newCustom = {
                  id: `custom_${Date.now()}`,
                  name: newCustomCategoryName.trim(),
                  icon: newCustomCategoryIcon.trim() || "🎯",
                  boards: [{ name: "Custom", clues16: Array(16).fill("Clue") }]
                };
                const updatedCustom = [...customCategories, newCustom];
                socket.emit("SETTINGS_UPDATE", {
                  lobbyId,
                  partialSettings: { customCategories: updatedCustom, categories: [...selectedCategories, newCustom.id] }
                });
                setNewCustomCategoryName("");
                setNewCustomCategoryIcon("🎯");
              }}
            >
              Add
            </button>
          </div>
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
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Players</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
  const [chatDraft, setChatDraft] = useState("");
  const [fraudGuessIndex, setFraudGuessIndex] = useState<number | null>(null);
  const [voteInput, setVoteInput] = useState<string>("");

  const isDetective = started ? started.visibleSecretForPlayer : false;
  const secretIndex = started?.secretIndexIfAllowed;
  const clueBoard16 = started?.clueBoard16 || Array.from({ length: 16 }).map((_, i) => `Clue ${i + 1}`);

  const me = players.find((p) => p.id === store.clientPlayerId);
  const votedFor = store.voteState?.votesByVoterId?.[store.clientPlayerId] || "";
  const anonymousVoting = store.lobbyState?.settings.anonymousVoting || false;

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

          <div style={{ marginTop: 10 }}>
            <label className="muted" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
              Type the name of who you think is The Fraud:
            </label>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={voteInput}
                onChange={(e) => setVoteInput(e.target.value)}
                placeholder="Player name"
                list="player-list"
              />
              <datalist id="player-list">
                {players.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
              <button
                className="btn btnPrimary"
                disabled={!voteInput.trim()}
                onClick={() => {
                  const targetPlayer = players.find((p) => p.name.toLowerCase() === voteInput.trim().toLowerCase());
                  if (targetPlayer) {
                    socket.emit("VOTE_SUBMIT", { lobbyId, targetPlayerId: targetPlayer.id });
                    setVoteInput("");
                  }
                }}
              >
                Submit Vote
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {players.map((p) => {
              const voteCount = store.voteState?.voteCountsByTargetId?.[p.id] || 0;
              const voters = anonymousVoting
                ? []
                : Object.entries(store.voteState?.votesByVoterId || {})
                    .filter(([, targetId]) => targetId === p.id)
                    .map(([voterId]) => players.find((pl) => pl.id === voterId)?.name)
                    .filter(Boolean);
              return (
                <div key={p.id} className="panel panelPad" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong>{p.name}</strong>
                      {voters.length > 0 && (
                        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                          ({voters.join(", ")})
                        </span>
                      )}
                    </div>
                    <div className="pill">
                      <strong>{voteCount}</strong> <span className="muted">vote{voteCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                </div>
              );
            })}
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

