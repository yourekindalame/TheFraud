import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { getSocket } from "../lib/socket";
import { setLobbyPasscode } from "../lib/storage";

export default function HomePage() {
  const { store, actions } = useApp();
  const socket = useMemo(() => getSocket(), []);
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(store.playerName || "");
  const [hostModalOpen, setHostModalOpen] = useState(false);
  const [hostLobbyNameDraft, setHostLobbyNameDraft] = useState("");
  const [isPrivateLobby, setIsPrivateLobby] = useState(false);

  const canPlay = Boolean(store.playerName);

  const handleHostSubmit = () => {
    if (!store.playerName || hostLobbyNameDraft.trim().length < 3) return;
    setBusy(true);
    setHostModalOpen(false);
    
    socket.emit(
      "LOBBY_CREATE",
      {
        lobbyName: hostLobbyNameDraft.trim(),
        isPrivate: isPrivateLobby,
        settingsDefaults: {}
      },
      (resp: { ok: boolean; lobbyId?: string; lobbyCode?: string; error?: string }) => {
        if (!resp?.ok || !resp.lobbyId || !resp.lobbyCode) {
          setBusy(false);
          // Reset modal state on error
          setHostLobbyNameDraft("");
          setIsPrivateLobby(false);
          return;
        }
        // Store the lobby code for future reference
        if (resp.lobbyCode) {
          setLobbyPasscode(resp.lobbyId, resp.lobbyCode);
        }
        // Join the lobby - include code if provided (required for private lobbies)
        socket.emit(
          "LOBBY_JOIN",
          {
            lobbyId: resp.lobbyId, // Join by ID
            ...(resp.lobbyCode ? { lobbyCode: resp.lobbyCode } : {}), // Include code if provided (private lobbies)
            playerName: store.playerName,
            clientPlayerId: store.clientPlayerId
          },
          () => {
            setBusy(false);
            setHostLobbyNameDraft("");
            setIsPrivateLobby(false);
            navigate(`/lobby/${resp.lobbyId}`);
          }
        );
      }
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, padding: "40px 20px", maxWidth: 600, margin: "0 auto" }}>
      {/* Title */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, fontWeight: 900, marginBottom: 12, background: "linear-gradient(135deg, var(--accent), var(--accent-pink))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", letterSpacing: "-0.02em" }}>
          The Fraud
        </div>
        <div className="muted" style={{ fontSize: 18 }}>
          Find the imposter. Survive the deception.
        </div>
      </div>

      {/* Player Name Card */}
      <div className="panel panelPad" style={{ width: "100%", textAlign: "center" }}>
        <div className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
          Playing as
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{store.playerName || "Guest"}</div>
          <button
            className="btn"
            style={{ padding: "8px 12px", borderRadius: 8 }}
            onClick={() => {
              setNameDraft(store.playerName || "");
              setEditNameOpen(true);
            }}
          >
            ✏️
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 16, width: "100%", flexDirection: "column" }}>
        <button
          className="btn btnPrimary"
          style={{ width: "100%", padding: "16px 24px", fontSize: 18, fontWeight: 700 }}
          disabled={!canPlay || busy}
          onClick={() => {
            if (!store.playerName) return;
            setHostModalOpen(true);
          }}
        >
          ➕ Host Game
        </button>

        <button
          className="btn"
          style={{ width: "100%", padding: "16px 24px", fontSize: 18, fontWeight: 600, borderColor: "rgba(34, 197, 94, 0.4)", background: "rgba(34, 197, 94, 0.08)" }}
          disabled={!canPlay || busy}
          onClick={() => {
            if (!store.playerName) return;
            // For join game, we'd need a modal or navigation - for now just navigate to lobbies
            navigate("/lobbies");
          }}
        >
          ➡️ Join Game
        </button>
      </div>

      {/* Credits */}
      <div className="muted" style={{ fontSize: 14, textAlign: "center" }}>
        Created by Nicole ❤️
      </div>

      {/* Host Game Modal */}
      {hostModalOpen && (
        <div className="modalBackdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setHostModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h2 style={{ fontWeight: 900, margin: 0 }}>Host Game</h2>
              <button className="btn" onClick={() => setHostModalOpen(false)} aria-label="Close" style={{ padding: "8px 12px" }}>
                ✕
              </button>
            </div>
            <div className="modalBody">
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label className="muted" style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
                    Lobby Name
                  </label>
                  <input
                    className="input"
                    value={hostLobbyNameDraft}
                    onChange={(e) => setHostLobbyNameDraft(e.target.value)}
                    placeholder="Enter lobby name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && hostLobbyNameDraft.trim().length >= 3) {
                        handleHostSubmit();
                      }
                    }}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={isPrivateLobby}
                      onChange={(e) => setIsPrivateLobby(e.target.checked)}
                      style={{ width: 18, height: 18, cursor: "pointer" }}
                    />
                    Private Lobby
                  </label>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4, marginLeft: 28 }}>
                    Requires a password to join
                  </div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 24, justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => setHostModalOpen(false)}>
                  Cancel
                </button>
                <button
                  className="btn btnPrimary"
                  disabled={hostLobbyNameDraft.trim().length < 3 || busy}
                  onClick={handleHostSubmit}
                >
                  Create Lobby
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Name Modal */}
      {editNameOpen && (
        <div className="modalBackdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setEditNameOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h2 style={{ fontWeight: 900, margin: 0 }}>Your name</h2>
              <button className="btn" onClick={() => setEditNameOpen(false)} aria-label="Close" style={{ padding: "8px 12px" }}>
                ✕
              </button>
            </div>
            <div className="modalBody">
              <div className="muted" style={{ marginBottom: 16 }}>
                This is saved in localStorage so you won't be asked again.
              </div>
              <input
                className="input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = nameDraft.trim();
                    if (v.length >= 2) {
                      actions.setPlayerName(v);
                      setEditNameOpen(false);
                    }
                  }
                }}
              />
              <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
