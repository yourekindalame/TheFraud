import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { getSocket } from "../lib/socket";
import { setLobbyPasscode } from "../lib/storage";

export default function HomePage() {
  const { store } = useApp();
  const socket = useMemo(() => getSocket(), []);
  const navigate = useNavigate();

  const [hostLobbyName, setHostLobbyName] = useState("");
  const [hostPasscode, setHostPasscode] = useState("");
  const [joinLobbyId, setJoinLobbyId] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");
  const [busy, setBusy] = useState(false);

  const canPlay = Boolean(store.playerName);

  return (
    <div className="grid2">
      <div className="panel panelPad">
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 6 }}>The Fraud</div>
        <div className="muted" style={{ marginBottom: 16 }}>
          Host a lobby, invite friends, and try to catch the liar.
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          <Link className="btn" to="/lobbies">
            Browse lobbies
          </Link>
          <a className="btn" href="https://fly.io" target="_blank" rel="noreferrer">
            Deploy on Fly.io
          </a>
        </div>

        <div className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Host Game</div>
          <label className="muted" style={{ fontSize: 12 }}>
            Lobby Name
          </label>
          <input className="input" value={hostLobbyName} onChange={(e) => setHostLobbyName(e.target.value)} placeholder="e.g. Friday Night" />
          <div style={{ height: 10 }} />
          <label className="muted" style={{ fontSize: 12 }}>
            Passcode (optional)
          </label>
          <input className="input" value={hostPasscode} onChange={(e) => setHostPasscode(e.target.value)} placeholder="Leave blank for public" />

          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn btnPrimary"
              disabled={!canPlay || busy || hostLobbyName.trim().length < 3}
              onClick={() => {
                if (!store.playerName) return;
                setBusy(true);
                socket.emit(
                  "LOBBY_CREATE",
                  {
                    lobbyName: hostLobbyName.trim(),
                    passcode: hostPasscode.trim() ? hostPasscode.trim() : undefined,
                    settingsDefaults: {}
                  },
                  (resp: { ok: boolean; lobbyId?: string; error?: string }) => {
                    if (!resp?.ok || !resp.lobbyId) {
                      setBusy(false);
                      return;
                    }
                    if (hostPasscode.trim()) setLobbyPasscode(resp.lobbyId, hostPasscode.trim());
                    socket.emit(
                      "LOBBY_JOIN",
                      {
                        lobbyId: resp.lobbyId,
                        passcode: hostPasscode.trim() ? hostPasscode.trim() : undefined,
                        playerName: store.playerName,
                        clientPlayerId: store.clientPlayerId
                      },
                      () => {
                        setBusy(false);
                        navigate(`/lobby/${resp.lobbyId}`);
                      }
                    );
                  }
                );
              }}
            >
              Host lobby
            </button>
            {!canPlay && <span className="muted">Set your name first.</span>}
          </div>
        </div>
      </div>

      <div className="panel panelPad">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Join by “Lobby Name”</div>
        <div className="muted" style={{ marginBottom: 10 }}>
          (This is the 6‑character lobby code. We just call it “Lobby Name” in the UI.)
        </div>
        <label className="muted" style={{ fontSize: 12 }}>
          Lobby Name
        </label>
        <input className="input" value={joinLobbyId} onChange={(e) => setJoinLobbyId(e.target.value.toUpperCase())} placeholder="e.g. A2BC9D" />
        <div style={{ height: 10 }} />
        <label className="muted" style={{ fontSize: 12 }}>
          Passcode (if locked)
        </label>
        <input className="input" value={joinPasscode} onChange={(e) => setJoinPasscode(e.target.value)} placeholder="Only needed if host locked it" />

        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn btnSuccess"
            disabled={!canPlay || busy || joinLobbyId.trim().length < 3}
            onClick={() => {
              if (!store.playerName) return;
              const id = joinLobbyId.trim().toUpperCase();
              if (joinPasscode.trim()) setLobbyPasscode(id, joinPasscode.trim());
              setBusy(true);
              socket.emit(
                "LOBBY_JOIN",
                {
                  lobbyId: id,
                  passcode: joinPasscode.trim() ? joinPasscode.trim() : undefined,
                  playerName: store.playerName,
                  clientPlayerId: store.clientPlayerId
                },
                (resp: { ok: boolean }) => {
                  setBusy(false);
                  if (resp?.ok) navigate(`/lobby/${id}`);
                }
              );
            }}
          >
            Join
          </button>
          <Link className="btn" to="/lobbies">
            Browse
          </Link>
        </div>
      </div>
    </div>
  );
}

