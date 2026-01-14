import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { getSocket } from "../lib/socket";
import { setLobbyPasscode } from "../lib/storage";

export default function LobbiesPage() {
  const { store } = useApp();
  const socket = useMemo(() => getSocket(), []);
  const navigate = useNavigate();
  const [joinLobbyId, setJoinLobbyId] = useState("");

  const canJoin = Boolean(store.playerName);

  return (
    <div className="grid2">
      <div className="panel panelPad">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Available lobbies</div>
          <button className="btn" onClick={() => socket.emit("LOBBY_LIST_REQUEST", {})}>
            Refresh
          </button>
        </div>

        {store.lobbyList.length === 0 ? (
          <div className="muted">No lobbies yet. Host one!</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {store.lobbyList.map((l) => (
              <div key={l.id} className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>
                      {l.name} {l.inGame ? "🎮" : ""}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Players: {l.playerCount}
                    </div>
                  </div>
                  <button
                    className="btn btnSuccess"
                    disabled={!canJoin}
                    onClick={() => {
                      if (!store.playerName) return;
                      // Public lobby: join by ID, no code required
                      socket.emit(
                        "LOBBY_JOIN",
                        {
                          lobbyId: l.id, // Join public lobby by ID (no code needed)
                          playerName: store.playerName,
                          clientPlayerId: store.clientPlayerId
                        },
                        (resp: { ok: boolean }) => {
                          if (resp?.ok) navigate(`/lobby/${l.id}`);
                        }
                      );
                    }}
                  >
                    Join
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel panelPad">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Join by Lobby Code</div>
        <label className="muted" style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
          Lobby Code
        </label>
        <input className="input" value={joinLobbyId} onChange={(e) => setJoinLobbyId(e.target.value.toUpperCase())} placeholder="Enter lobby code (e.g. BAHM4T)" style={{ textTransform: "uppercase" }} />

        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn" to="/">
            Back
          </Link>
          <button
            className="btn btnPrimary"
            disabled={!canJoin || joinLobbyId.trim().length < 3}
            onClick={() => {
              if (!store.playerName || !joinLobbyId.trim()) return;
              // Join by code: send code, server will find lobby
              socket.emit(
                "LOBBY_JOIN",
                {
                  lobbyCode: joinLobbyId.trim().toUpperCase(),
                  playerName: store.playerName,
                  clientPlayerId: store.clientPlayerId
                },
                (resp: { ok: boolean; lobbyId?: string }) => {
                  if (resp?.ok && resp.lobbyId) {
                    setLobbyPasscode(resp.lobbyId, joinLobbyId.trim().toUpperCase());
                    navigate(`/lobby/${resp.lobbyId}`);
                  }
                }
              );
            }}
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}

