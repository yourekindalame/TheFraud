import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { getSocket } from "../lib/socket";
import { setLobbyPasscode } from "../lib/storage";

export default function LobbiesPage() {
  const { store } = useApp();
  const socket = useMemo(() => getSocket(), []);
  const navigate = useNavigate();
  const [passcodes, setPasscodes] = useState<Record<string, string>>({});
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
              <div key={l.lobbyId} className="panel panelPad" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>
                      {l.lobbyName} {l.locked ? "🔒" : ""} {l.inGame ? "🎮" : ""}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Lobby: <strong>{l.lobbyId}</strong> · Players: {l.playerCount}
                    </div>
                  </div>
                  <button
                    className="btn btnSuccess"
                    disabled={!canJoin}
                    onClick={() => {
                      if (!store.playerName) return;
                      const pass = (passcodes[l.lobbyId] || "").trim();
                      if (pass) setLobbyPasscode(l.lobbyId, pass);
                      socket.emit(
                        "LOBBY_JOIN",
                        {
                          lobbyId: l.lobbyId,
                          passcode: pass || undefined,
                          playerName: store.playerName,
                          clientPlayerId: store.clientPlayerId
                        },
                        (resp: { ok: boolean }) => {
                          if (resp?.ok) navigate(`/lobby/${l.lobbyId}`);
                        }
                      );
                    }}
                  >
                    Join
                  </button>
                </div>

                {l.locked && (
                  <div style={{ marginTop: 10 }}>
                    <label className="muted" style={{ fontSize: 12 }}>
                      Passcode
                    </label>
                    <input
                      className="input"
                      value={passcodes[l.lobbyId] || ""}
                      onChange={(e) => setPasscodes((p) => ({ ...p, [l.lobbyId]: e.target.value }))}
                      placeholder="Required to join"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel panelPad">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Join by “Lobby Name”</div>
        <label className="muted" style={{ fontSize: 12 }}>
          Lobby Name
        </label>
        <input className="input" value={joinLobbyId} onChange={(e) => setJoinLobbyId(e.target.value.toUpperCase())} placeholder="e.g. A2BC9D" />

        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn" to="/">
            Back
          </Link>
          <button className="btn btnPrimary" disabled={!canJoin || joinLobbyId.trim().length < 3} onClick={() => navigate(`/lobby/${joinLobbyId.trim().toUpperCase()}`)}>
            Go
          </button>
        </div>
      </div>
    </div>
  );
}

