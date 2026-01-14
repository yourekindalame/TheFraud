export type LobbySummary = {
  id: string; // Internal lobby ID for joining public lobbies
  name: string; // Human-friendly lobby name
  playerCount: number;
  inGame: boolean;
};

export type PlayerPublic = {
  id: string;
  name: string;
  points: number;
  joinedAt: number;
  connected: boolean;
  profileImage?: string | null;
};

export type LobbySettings = {
  categories: string[];
  customCategories: Array<{ id: string; name: string; icon: string; boards: Array<{ name: string; clues16: string[] }> }>;
  imposterCount: number;
  randomizeImposterCount: boolean;
  anonymousVoting: boolean;
  fraudNeverGoesFirst: boolean;
  timeLimitEnabled: boolean;
  timeLimitSeconds: number;
};

export type LobbyState = {
  lobbyId: string; // Internal lobby ID
  lobbyName: string; // Human-friendly name
  lobbyCode: string; // Secret join code
  hostPlayerId: string | null;
  players: PlayerPublic[];
  settings: LobbySettings;
  gameState?: {
    phase: "lobby" | "clues" | "voting" | "fraud_guess";
    roundId: string | null;
    categoryName: string | null;
    cluesByPlayerId?: Record<string, string>;
  };
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

