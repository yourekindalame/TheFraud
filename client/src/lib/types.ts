export type LobbySummary = {
  lobbyId: string;
  lobbyName: string;
  locked: boolean;
  playerCount: number;
  inGame: boolean;
};

export type PlayerPublic = {
  id: string;
  name: string;
  points: number;
  joinedAt: number;
  connected: boolean;
};

export type LobbySettings = {
  category: string;
  imposterCount: number;
  randomizeImposterCount: boolean;
  fraudNeverGoesFirst: boolean;
  timeLimitEnabled: boolean;
  timeLimitSeconds: number;
};

export type LobbyState = {
  lobbyId: string;
  hostPlayerId: string | null;
  players: PlayerPublic[];
  settings: LobbySettings;
  gameState?: { phase: "lobby" | "clues" | "voting" | "fraud_guess"; roundId: string | null; categoryName: string | null };
};

export type LeaderboardEntry = { playerId: string; name: string; points: number };

export type ChatMessage = {
  id: string;
  at: number;
  fromPlayerId: string;
  fromName: string;
  text: string;
};

export type CategoryMeta = { id: string; name: string; icon: string };

