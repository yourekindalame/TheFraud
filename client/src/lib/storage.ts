const KEY_NAME = "thefraud.playerName";
const KEY_PLAYER_ID = "thefraud.clientPlayerId";
const KEY_LOBBY_CODE_PREFIX = "thefraud.lobbycode.";
const KEY_PROFILE_IMAGE = "thefraud.profileImage";

export function getPlayerName(): string | null {
  const v = localStorage.getItem(KEY_NAME);
  return v && v.trim() ? v : null;
}

export function setPlayerName(name: string) {
  localStorage.setItem(KEY_NAME, name.trim().slice(0, 24));
}

export function getProfileImage(): string | null {
  return localStorage.getItem(KEY_PROFILE_IMAGE);
}

export function setProfileImage(imageDataUrl: string | null) {
  if (imageDataUrl) {
    localStorage.setItem(KEY_PROFILE_IMAGE, imageDataUrl);
  } else {
    localStorage.removeItem(KEY_PROFILE_IMAGE);
  }
}

export function getClientPlayerId(): string {
  const existing = localStorage.getItem(KEY_PLAYER_ID);
  if (existing && existing.trim()) return existing;
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p_${Math.random().toString(16).slice(2)}${Date.now()}`;
  localStorage.setItem(KEY_PLAYER_ID, id);
  return id;
}

export function setLobbyPasscode(lobbyId: string, lobbyCode: string) {
  sessionStorage.setItem(KEY_LOBBY_CODE_PREFIX + lobbyId, lobbyCode);
}

export function getLobbyPasscode(lobbyId: string): string | null {
  const v = sessionStorage.getItem(KEY_LOBBY_CODE_PREFIX + lobbyId);
  return v && v.trim() ? v : null;
}

