import React, { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { getSocket } from "./lib/socket";
import { getClientPlayerId, getPlayerName, setPlayerName as persistName } from "./lib/storage";
import type { CategoryMeta, ChatMessage, LeaderboardEntry, LobbyState, LobbySummary } from "./lib/types";
import { AppContext, type GameStartedPayload, type VoteStatePayload } from "./AppContext";
import { RulesModal } from "./components/RulesModal";
import { Modal } from "./components/Modal";
import HomePage from "./pages/HomePage";
import LobbiesPage from "./pages/LobbiesPage";
import LobbyPage from "./pages/LobbyPage";

type ServerError = { code: string; message: string };

export default function App() {
  const navigate = useNavigate();
  const socket = useMemo(() => getSocket(), []);
  const clientPlayerId = useMemo(() => getClientPlayerId(), []);

  const [playerName, setPlayerNameState] = useState<string | null>(() => getPlayerName());
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [lobbyList, setLobbyList] = useState<LobbySummary[]>([]);
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [gameStarted, setGameStarted] = useState<GameStartedPayload | null>(null);
  const [voteState, setVoteState] = useState<VoteStatePayload | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [lastError, setLastError] = useState<ServerError | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(playerName || "");

  const store = { clientPlayerId, playerName, categories, lobbyList, lobbyState, gameStarted, voteState, chat, leaderboard, lastError };
  const actions = {
    setPlayerName: (name: string) => {
      const v = name.trim().slice(0, 24);
      persistName(v);
      setPlayerNameState(v);
    },
    clearChat: () => setChat([])
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/meta");
        const json = (await res.json()) as { categories: CategoryMeta[] };
        setCategories(json.categories || []);
      } catch {
        // ignore; server may not be up yet
      }
    })();
  }, []);

  useEffect(() => {
    const onLobbyList = (payload: { lobbies: LobbySummary[] }) => setLobbyList(payload.lobbies || []);
    const onLobbyState = (payload: LobbyState) => {
      setLobbyState(payload);
      // Reset client-side phase helpers when returning to lobby.
      if (payload?.gameState?.phase === "lobby") {
        setGameStarted(null);
        setVoteState(null);
      }
    };
    const onGameStarted = (payload: GameStartedPayload) => {
      setGameStarted(payload);
      setVoteState(null);
      setChat([]);
      navigate(`/lobby/${payload.lobbyId}`);
    };
    const onVoteState = (payload: VoteStatePayload) => setVoteState(payload);
    const onChat = (payload: { lobbyId: string; messageObj: ChatMessage }) => setChat((c) => [...c, payload.messageObj]);
    const onScore = (payload: { lobbyId: string; leaderboard: LeaderboardEntry[] }) => setLeaderboard(payload.leaderboard || []);
    const onError = (payload: ServerError) => setLastError(payload);

    socket.on("LOBBY_LIST", onLobbyList);
    socket.on("LOBBY_STATE", onLobbyState);
    socket.on("GAME_STARTED", onGameStarted);
    socket.on("VOTE_STATE", onVoteState);
    socket.on("CHAT_MESSAGE", onChat);
    socket.on("SCORE_UPDATE", onScore);
    socket.on("ERROR", onError);

    socket.emit("LOBBY_LIST_REQUEST", {});

    return () => {
      socket.off("LOBBY_LIST", onLobbyList);
      socket.off("LOBBY_STATE", onLobbyState);
      socket.off("GAME_STARTED", onGameStarted);
      socket.off("VOTE_STATE", onVoteState);
      socket.off("CHAT_MESSAGE", onChat);
      socket.off("SCORE_UPDATE", onScore);
      socket.off("ERROR", onError);
    };
  }, [navigate, socket]);

  const nameMissing = !playerName;

  return (
    <AppContext.Provider value={{ store, actions }}>
      <div className="header">
        <div className="headerInner">
          <Link to="/" className="logo" aria-label="Home">
            <div className="logoMark">F</div>
            <div>The Fraud</div>
          </Link>

          <div className="row">
            {playerName ? (
              <span className="pill">
                <span className="muted">Welcome,</span> <strong>{playerName}</strong>
                <button
                  className="btn"
                  style={{ padding: "6px 10px", borderRadius: 999 }}
                  onClick={() => {
                    setNameDraft(playerName);
                    setEditNameOpen(true);
                  }}
                >
                  Edit
                </button>
              </span>
            ) : (
              <span className="pill">
                <span className="muted">Welcome</span>
                <button className="btn" style={{ padding: "6px 10px", borderRadius: 999 }} onClick={() => setEditNameOpen(true)}>
                  Set name
                </button>
              </span>
            )}

            <button className="btn" onClick={() => setRulesOpen(true)}>
              Rules
            </button>
          </div>
        </div>
      </div>

      <div className="container">
        {lastError && (
          <div className="panel panelPad" style={{ borderColor: "rgba(239,68,68,0.35)", marginBottom: 12 }}>
            <strong>Error:</strong> {lastError.message} <span className="muted">({lastError.code})</span>
          </div>
        )}

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/lobbies" element={<LobbiesPage />} />
          <Route path="/lobby/:lobbyId" element={<LobbyPage />} />
        </Routes>
      </div>

      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}

      {editNameOpen && (
        <Modal title="Your name" onClose={() => setEditNameOpen(false)}>
          <div className="muted" style={{ marginBottom: 10 }}>
            This is saved in localStorage so you won’t be asked again.
          </div>
          <input className="input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Name" />
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setEditNameOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btnPrimary"
              onClick={() => {
                const v = nameDraft.trim();
                if (v.length < 2) return;
                actions.setPlayerName(v);
                setEditNameOpen(false);
              }}
            >
              Save
            </button>
          </div>
        </Modal>
      )}

      {nameMissing && (
        <Modal title="Pick your name" onClose={() => setEditNameOpen(true)}>
          <div className="muted" style={{ marginBottom: 10 }}>
            We’ll remember it forever (on this device).
          </div>
          <div className="row">
            <input className="input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Name" />
            <button
              className="btn btnPrimary"
              onClick={() => {
                const v = nameDraft.trim();
                if (v.length < 2) return;
                actions.setPlayerName(v);
              }}
            >
              Continue
            </button>
          </div>
        </Modal>
      )}
    </AppContext.Provider>
  );
}

