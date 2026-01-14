# The Fraud - Complete System Prompt

## Overview

**The Fraud** is a production-ready, web-based multiplayer deduction party game. Players join lobbies, receive roles (Detective or Fraud), give clues, vote to eliminate suspects, and score points. The first player to reach 10 points wins.

### Technology Stack

- **Backend**: Node.js 20+ + Express + Socket.IO (authoritative server state)
- **Frontend**: Vite + React 18 + TypeScript
- **Real-time**: Socket.IO (bidirectional WebSocket communication)
- **Storage**: In-memory (server) + localStorage (client)
- **Deployment**: Single Fly.io app (Express serves React build; Socket.IO on same origin/port)
- **Dependencies**: 
  - Server: `express`, `socket.io`, `nanoid`, `bcryptjs`, `cors`, `dotenv`
  - Client: `react`, `react-dom`, `react-router-dom`, `socket.io-client`

---

## Project Structure

```
TheFraud/
├── client/                    # Vite + React + TypeScript frontend
│   ├── src/
│   │   ├── App.tsx           # Root component, routing, global socket listeners
│   │   ├── AppContext.tsx    # React context for global state
│   │   ├── main.tsx          # React entry point
│   │   ├── styles.css        # Global CSS variables and styles
│   │   ├── components/       # Reusable components
│   │   │   ├── HoldButton.tsx    # Hold-to-confirm button component
│   │   │   ├── Modal.tsx         # Modal component
│   │   │   └── RulesModal.tsx    # Rules modal component
│   │   ├── lib/              # Utilities
│   │   │   ├── socket.ts     # Socket.IO client singleton
│   │   │   ├── storage.ts    # localStorage helpers
│   │   │   └── types.ts      # TypeScript type definitions
│   │   └── pages/            # Page components
│   │       ├── HomePage.tsx      # Homepage (host/join lobby)
│   │       ├── LobbiesPage.tsx   # Public lobby browser
│   │       └── LobbyPage.tsx     # Lobby/game view (main UI)
│   ├── vite.config.ts
│   └── package.json
├── server/                    # Express + Socket.IO backend
│   ├── src/
│   │   ├── index.js          # Express app, Socket.IO server, event handlers
│   │   └── state.js          # Game state management, lobby logic
│   ├── data/
│   │   ├── clues.json        # Category and clue board data
│   │   └── banned-words.txt  # Banned words for lobby names
│   ├── scripts/
│   │   └── copyClientBuild.js  # Build script helper
│   └── package.json
├── package.json              # Root scripts (setup, dev, build, start)
├── Dockerfile                # Production Docker image
├── fly.toml                  # Fly.io deployment config
└── readme.md                 # Project documentation
```

---

## Core Game Concepts

### Roles

- **Detective**: Knows the secret word. Goal: Give clear clues and identify The Fraud.
- **Fraud**: Does NOT know the secret word. Goal: Blend in with vague clues, survive voting, guess the word.

### Game Flow

1. **Lobby Phase**: Players join, host configures settings, categories selected
2. **Clues Phase**: Players submit one-word clues (visible only to themselves until voting)
3. **Voting Phase**: Players vote to eliminate a suspect (can be anonymous)
4. **Fraud Guess Phase**: If Fraud survives, they guess the secret word from the clue board
5. **Round End**: Results displayed, scoring applied, next round starts or game ends

### Scoring Rules

- Detectives eliminate The Fraud: +1 point each Detective
- Fraud survives a vote: +1 point each surviving Fraud
- Fraud guesses the secret word correctly: +1 bonus point
- First player to reach 10 points wins

### Lobby System

- **Lobby Name**: Human-friendly display name (cosmetic only, NOT secret)
- **Lobby Code**: Auto-generated 6-character secret code (the ONLY secret for joining)
- **Public Lobbies**: Visible in lobby list, joinable by ID without code
- **Private Lobbies**: Hidden from list, require Lobby Code to join
- **Host**: Can start games, change settings, transfer host, end rounds early

---

## TypeScript Types

### Core Types (`client/src/lib/types.ts`)

```typescript
export type LobbySummary = {
  id: string;              // Internal lobby ID
  name: string;            // Human-friendly lobby name
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
  categories: string[];                              // Selected category IDs
  customCategories: Array<{                          // User-created categories
    id: string;
    name: string;
    icon: string;
    boards: Array<{ name: string; clues16: string[] }>;
  }>;
  imposterCount: number;                             // Number of Frauds
  randomizeImposterCount: boolean;                   // Randomize fraud count
  anonymousVoting: boolean;                          // Hide voter names
  fraudNeverGoesFirst: boolean;                      // Unused (reserved)
  timeLimitEnabled: boolean;                         // Unused (reserved)
  timeLimitSeconds: number;                          // Unused (reserved)
};

export type LobbyState = {
  lobbyId: string;           // Internal lobby ID
  lobbyName: string;         // Human-friendly name
  lobbyCode: string;         // Secret join code (6 chars)
  hostPlayerId: string | null;
  players: PlayerPublic[];
  settings: LobbySettings;
  gameState?: {
    phase: "lobby" | "clues" | "voting" | "fraud_guess" | "round_results";
    roundId: string | null;
    categoryName: string | null;
    cluesByPlayerId?: Record<string, string>;  // Player ID -> clue text
  };
};

export type LeaderboardEntry = {
  playerId: string;
  name: string;
  points: number;
};

export type ChatMessage = {
  id: string;
  at: number;
  fromPlayerId: string;
  fromName: string;
  text: string;
};

export type CategoryMeta = {
  id: string;
  name: string;
  icon: string;
};
```

### App Context Types (`client/src/AppContext.tsx`)

```typescript
export type GameStartedPayload = {
  lobbyId: string;
  roundId: string;
  category: string;
  clueBoard16: string[];           // Array of 16 clue words
  visibleSecretForPlayer: boolean; // true = Detective, false = Fraud
  secretIndexIfAllowed?: number;   // Only for Detectives (0-15)
};

export type VoteStatePayload = {
  lobbyId: string;
  votesByVoterId?: Record<string, string>;      // Voter ID -> target player ID
  voteCountsByTargetId?: Record<string, number>; // Target ID -> vote count
  allSubmittedBoolean?: boolean;
  voteToStartCount?: number;
  voteToStartRequired?: number;
};
```

---

## Socket.IO Event Contract

### Client → Server Events

#### Lobby Management

- **`LOBBY_LIST_REQUEST {}`**
  - Request public lobby list
  - Response: Server emits `LOBBY_LIST`

- **`LOBBY_CREATE { lobbyName: string, isPrivate: boolean, settingsDefaults?: Partial<LobbySettings> }`**
  - Create a new lobby
  - Host-only: No (anyone can create)
  - Response: `{ ok: boolean, lobbyId?: string, lobbyCode?: string, error?: string }`
  - Server auto-generates `lobbyCode` (6 chars)
  - If `isPrivate = true`, lobby excluded from public list

- **`LOBBY_JOIN { lobbyId?: string, lobbyCode?: string, playerName: string, clientPlayerId: string }`**
  - Join a lobby by ID (public) or code (private/public)
  - If `lobbyId` provided: join public lobby directly
  - If `lobbyCode` provided: lookup by code (works for private/public)
  - Response: `{ ok: boolean, lobbyId?: string, hostPlayerId?: string, lobbyCode?: string, error?: string }`
  - Auto-assigns host if missing

- **`LOBBY_LEAVE { lobbyId: string }`**
  - Leave current lobby
  - Response: `{ ok: boolean, error?: string }`
  - Auto-reassigns host if host leaves

#### Settings & Host Actions

- **`SETTINGS_UPDATE { lobbyId: string, partialSettings: Partial<LobbySettings> }`**
  - Update lobby settings
  - Host-only: Yes
  - Response: `{ ok: boolean, error?: string }`

- **`HOST_TRANSFER { lobbyId: string, newHostPlayerId: string }`**
  - Transfer host to another player
  - Host-only: Yes
  - Response: `{ ok: boolean, error?: string }`
  - Server emits `HOST_CHANGED` to all players

#### Game Flow

- **`GAME_START { lobbyId: string }`**
  - Start a new game round
  - Host-only: Yes
  - Response: `{ ok: boolean, error?: string }`
  - Server emits `GAME_STARTED` to all players (per-player payloads)

- **`CLUE_SUBMIT { lobbyId: string, clue: string }`**
  - Submit a one-word clue
  - Phase: Must be `"clues"`
  - Response: `{ ok: boolean, error?: string }`
  - Clue stored in `gameState.cluesByPlayerId[playerId]`
  - Visible to submitting player only until voting phase

- **`VOTE_TO_START_VOTING { lobbyId: string }`**
  - Vote to transition from clues phase to voting phase
  - Phase: Must be `"clues"`
  - Requires 50%+ players to vote
  - Response: `{ ok: boolean, voteCount?: number, requiredVotes?: number, error?: string }`

- **`VOTING_START { lobbyId: string }`**
  - Manually start voting phase (bypass vote-to-start)
  - Host-only: Yes
  - Phase: Must be `"clues"`
  - Response: `{ ok: boolean, error?: string }`

- **`VOTE_SUBMIT { lobbyId: string, targetPlayerId: string }`**
  - Submit a vote for a player
  - Phase: Must be `"voting"`
  - Response: `{ ok: boolean, error?: string }`
  - Auto-triggers `finishVoting()` when all players voted

- **`VOTING_END_EARLY { lobbyId: string }`**
  - End voting phase early
  - Host-only: Yes
  - Phase: Must be `"voting"`
  - Response: `{ ok: boolean, error?: string }`
  - UI should use hold-to-confirm (3 seconds)

- **`FRAUD_GUESS { lobbyId: string, guessIndex: number | null }`**
  - Submit fraud's guess (0-15 index) or skip (null)
  - Phase: Must be `"fraud_guess"`
  - Fraud-only: Yes (server validates)
  - Response: `{ ok: boolean, correct?: boolean, error?: string }`
  - UI should use hold-to-confirm for skip (3 seconds)

- **`ROUND_END { lobbyId: string }`**
  - End current round early
  - Host-only: Yes
  - Response: `{ ok: boolean, error?: string }`
  - UI should use hold-to-confirm (5 seconds)

- **`ROUND_NEXT { lobbyId: string }`**
  - Start next round from round end phase
  - Host-only: Yes
  - Phase: Must be `"round_results"`
  - Response: `{ ok: boolean, error?: string }`

- **`END_GAME { lobbyId: string }`**
  - End game and return to lobby
  - Host-only: Yes
  - Response: `{ ok: boolean, error?: string }`

#### Chat

- **`CHAT_SEND { lobbyId: string, message: string }`**
  - Send a chat message
  - Response: `{ ok: boolean, error?: string }`
  - Server emits `CHAT_MESSAGE` to all players in lobby

### Server → Client Events

- **`LOBBY_LIST { lobbies: LobbySummary[] }`**
  - Public lobby list update
  - Only includes non-private lobbies

- **`LOBBY_STATE { ...LobbyState }`**
  - Complete lobby state update
  - Emitted on join, settings change, phase change, etc.
  - `cluesByPlayerId` visibility:
    - `"clues"` phase: Only requesting player's clue
    - `"voting"`/`"fraud_guess"`/`"round_results"` phases: All clues

- **`HOST_CHANGED { lobbyId: string, hostPlayerId: string }`**
  - Host transfer notification

- **`GAME_STARTED { lobbyId: string, roundId: string, category: string, clueBoard16: string[], visibleSecretForPlayer: boolean, secretIndexIfAllowed?: number }`**
  - New round started
  - Per-player payload (secret index only for Detectives)
  - Clients should reset role reveal state

- **`VOTE_STATE { lobbyId: string, votesByVoterId?: Record<string, string>, voteCountsByTargetId?: Record<string, number>, allSubmittedBoolean?: boolean, voteToStartCount?: number, voteToStartRequired?: number }`**
  - Voting state update
  - Emitted on vote submission, vote-to-start, etc.

- **`VOTE_REVEAL { lobbyId: string, fraudIds: string[], resultsSummary: { endedEarly: boolean, eliminatedPlayerId?: string, fraudEliminated: boolean, summary: string } }`**
  - Voting results revealed
  - Shows fraud identities and elimination result

- **`FRAUD_GUESS_PROMPT { lobbyId: string, category: string, clueBoard16: string[] }`**
  - Prompt Fraud to guess (if they survived)
  - Emitted only to Fraud players
  - **NOTE**: Current implementation uses inline clue board instead of modal

- **`ROUND_ENDED { lobbyId: string, results: { fraudWon: boolean, fraudLost: boolean, majorityVote: boolean, fraudIds: string[], fraudNames: string[], correctWord: string, fraudGuessedCorrectly?: boolean, fraudGuessWord?: string, eliminatedPlayerId?: string, eliminatedPlayerName?: string, winner?: { playerId: string, name: string, points: number } } }`**
  - Round ended with results
  - Contains all round outcome data

- **`SCORE_UPDATE { lobbyId: string, leaderboard: LeaderboardEntry[] }`**
  - Leaderboard update
  - Emitted after scoring changes

- **`CHAT_MESSAGE { lobbyId: string, messageObj: ChatMessage }`**
  - New chat message
  - Clients append to chat array

- **`ERROR { code: string, message: string }`**
  - Error notification
  - Common codes: `NOT_HOST`, `BAD_PHASE`, `NOT_VOTING`, `NOT_GUESSING`, `BAD_LOBBY_CODE`, `PRIVATE_LOBBY_REQUIRES_CODE`

---

## Server Architecture

### State Management (`server/src/state.js`)

Lobbies stored in-memory in a `Map<lobbyId, Lobby>`. Each lobby contains:

```javascript
{
  lobbyId: string,              // Internal ID (generated)
  lobbyCode: string,            // Secret join code (6 chars, generated)
  lobbyName: string,            // Human-friendly name
  isPrivate: boolean,           // Private = not in public list
  hostPlayerId: string | null,
  settings: LobbySettings,
  players: Array<{
    id: string,
    name: string,
    points: number,
    joinedAt: number,
    connected: boolean,
    socketId: string | null
  }>,
  gameState: {
    phase: "lobby" | "clues" | "voting" | "fraud_guess" | "round_results",
    roundId: string | null,
    categoryId: string | null,
    categoryName: string | null,
    clueBoard16: string[] | null,        // 16 clue words
    secretIndex: number | null,          // 0-15
    fraudIds: string[],                  // Array of fraud player IDs
    votesByVoterId: Record<string, string>,  // Voter ID -> target ID
    voteToStartVoterIds: Set<string>,    // Players who voted to start
    cluesByPlayerId: Record<string, string>, // Player ID -> clue text
    lastVoteResult: object | null        // Round results data
  }
}
```

### Key Server Functions

- **`createLobby({ lobbyName, isPrivate, settingsDefaults })`**: Creates new lobby, generates IDs
- **`startGameRound(lobby)`**: Initializes new round, selects category, assigns frauds, creates clue board
- **`computeVoteState(lobby)`**: Calculates vote counts and completion status
- **`resolveVoting(lobby)`**: Determines eliminated player and if fraud eliminated
- **`applyScoringAfterVote(lobby, { eliminatedPlayerId, fraudEliminated })`**: Applies scoring after voting
- **`applyFraudGuess(lobby, guessIndex)`**: Applies fraud guess scoring
- **`getLeaderboard(lobby)`**: Returns sorted leaderboard
- **`publicLobbyState(lobby, requestingPlayerId)`**: Sanitizes lobby state for client
- **`publicLobbySummary(lobby)`**: Creates public lobby summary (no secrets)

### Game Flow Functions (`server/src/index.js`)

- **`finishVoting(lobby, endedEarly)`**: Completes voting phase, applies scoring, transitions to fraud guess or round end
- **`endRoundToLobby(lobby, reason, roundResults)`**: Ends round, emits `ROUND_ENDED` with results, sets phase to `"round_results"`
- **`startNextRound(lobby)`**: Starts new round or ends game if winner (10 points)

### Socket Connection Tracking

Server maintains `Map<socketId, { lobbyId, playerId }>` to track socket memberships. On disconnect, removes player, reassigns host if needed.

---

## Client Architecture

### State Management (`client/src/App.tsx`)

Global state via React Context (`AppContext.tsx`):

```typescript
{
  clientPlayerId: string,        // Generated once, stored in localStorage
  playerName: string | null,     // Stored in localStorage
  categories: CategoryMeta[],    // Loaded from /api/meta
  lobbyList: LobbySummary[],
  lobbyState: LobbyState | null,
  gameStarted: GameStartedPayload | null,  // Current round data
  voteState: VoteStatePayload | null,
  chat: ChatMessage[],
  leaderboard: LeaderboardEntry[],
  lastError: { code: string, message: string } | null
}
```

### Key Components

#### `App.tsx`
- Root component with routing
- Global socket event listeners
- Player name management
- Provides AppContext

#### `HomePage.tsx`
- Homepage with "Host Game" and "Join Game" buttons
- Host modal: Lobby Name input + Private toggle
- Join by code input
- Link to public lobby browser

#### `LobbiesPage.tsx`
- Public lobby list
- Shows lobby name, player count, in-game status
- Click to join (uses lobby ID)

#### `LobbyPage.tsx`
- Main lobby/game view
- Two sub-views: `LobbySetup` (phase === "lobby") and `GameView` (game phases)
- `LobbySetup`: Category selection, settings, player list, start game
- `GameView`: Clue board, clue submission, voting, fraud guess, role reveal

#### `GameView` Component Features

- **Role Reveal**: Two-step modal (ready → reveal) at round start
- **Clue Board**: 4×4 grid of clue words (16 total)
  - Detectives see secret word highlighted (after role reveal)
  - Fraud sees normal board
  - During `fraud_guess` phase, tiles become clickable for Fraud
- **Clue Submission**: Input field + submit button (clues phase only)
- **Voting**: Click player buttons to vote (voting phase)
- **Fraud Guess**: Click clue board tiles + submit/skip buttons (fraud_guess phase)
- **Round Results**: Modal showing outcomes (round_results phase)

### Local Storage (`client/src/lib/storage.ts`)

- `clientPlayerId`: Generated once, persistent
- `playerName`: User's display name
- `lobbyPasscode`: Stores lobby codes for auto-fill (keyed by lobby ID)

### Socket Client (`client/src/lib/socket.ts`)

Singleton Socket.IO client instance. Connects on import, uses same origin (dev: proxies, prod: same port).

---

## UI/UX Design System

### Color Palette (`client/src/styles.css`)

```css
--bg: #0f0d1a                    /* Deep dark background */
--panel: #1e293b                 /* Slate-800 card background */
--card: #1e293b
--border: #334155                /* Slate-700 border */
--muted: #94a3b8                 /* Slate-400 muted text */
--foreground: #f8fafc            /* Slate-50 primary text */
--accent: #a855f7                /* Purple-500 primary accent */
--accent-dark: #9333ea           /* Purple-600 */
--accent-pink: #ec4899           /* Pink-500 secondary accent */
--accent-pink-dark: #db2777      /* Pink-600 */
--accent-cyan: #22d3ee           /* Cyan-400 */
--accent-cyan-dark: #06b6d4      /* Cyan-500 */
--accent2: #10b981               /* Emerald-500 success */
--accent2-dark: #059669
--success-green: #22c55e
--warning-yellow: #eab308        /* Yellow-500 */
--danger-red: #ef4444            /* Red-500 */
```

### Design Principles

- **Dark, cinematic, premium aesthetic**
- **Flat design** (minimal shadows, no glassmorphism)
- **Mobile-first, desktop-enhanced**
- **Game-like but not childish**
- **Stream-friendly** (readable, clean)
- **Visual hierarchy**: Large headers, generous spacing, clear CTAs

### Component Patterns

- **Panels**: `panel panelPad` classes (dark background, border, padding)
- **Buttons**: `btn`, `btnPrimary`, `btnDanger` classes
- **Tiles**: `.tile` for clue board items, `.tileSecret` for highlighted secret
- **Board**: `.board` grid (4 columns, responsive)
- **Modals**: `.modalBackdrop` + `.modal` with `.modalHeader` + `.modalBody`

### Hold-to-Confirm Actions

Critical actions use `HoldButton` component (3-5 second hold):
- End voting early (3s)
- Skip fraud guess (3s)
- End round (5s)
- End game (3s)

---

## Game Flow Details

### Round Start (`GAME_START`)

1. Host clicks "Start Game"
2. Server: `startGameRound(lobby)`
   - Selects random category from selected categories
   - Loads clue board (16 words from category)
   - Picks random secret index (0-15)
   - Assigns frauds (based on `imposterCount` setting)
3. Server: Emits `GAME_STARTED` to each player individually
   - Detectives: Includes `secretIndexIfAllowed`
   - Frauds: No secret index
4. Clients: Show role reveal modal
5. After role reveal: Show clue board (secret highlighted for Detectives)

### Clues Phase

- Players submit one-word clues
- Clues stored in `gameState.cluesByPlayerId[playerId]`
- Visible to submitting player only (via `publicLobbyState` filtering)
- Players can vote to start voting (50% threshold) or host can manually start

### Voting Phase

- Players click player buttons to vote
- Votes stored in `gameState.votesByVoterId[voterId] = targetId`
- Server emits `VOTE_STATE` updates
- When all votes submitted OR host ends early: `finishVoting()` called
- Server resolves voting, applies scoring, emits `VOTE_REVEAL`

### Fraud Guess Phase

- If Fraud survived voting: Phase changes to `"fraud_guess"`
- Fraud players see clickable clue board tiles
- Fraud selects tile (highlighted), clicks "Submit Guess" or "Skip"
- Server: `applyFraudGuess()`, then `endRoundToLobby()`

### Round End Phase

- Server emits `ROUND_ENDED` with comprehensive results
- Phase set to `"round_results"`
- Clients show results modal with:
  - Fraud won/lost
  - Majority vote status
  - Fraud identity
  - Secret word
  - Fraud guess result
  - Winner (if 10 points reached)
- Host can start next round or end game
- Auto-start countdown (20 seconds) for host

### Game End

- When player reaches 10 points: Game ends
- Results modal shows winner
- Host clicks "Back to Lobby" to reset

---

## Security & Validation

### Server-Side Validation

- **Host-only actions**: All critical actions validate `isHost()` before execution
- **Phase validation**: Actions validate current game phase
- **Player membership**: Actions validate socket is in lobby
- **Input sanitization**: Names, messages, clues trimmed and length-limited
- **Lobby code**: Private lobbies require code validation
- **Banned words**: Lobby names checked against banned words list

### Client-Side UX

- **Hold-to-confirm**: Destructive actions require hold (prevents accidental clicks)
- **Role reveal gating**: Detectives don't see secret until they click through modal
- **Clue visibility**: Server filters clues by phase (clues phase = own only)
- **Socket reconnection**: Clients auto-reconnect, maintain state

---

## Development Workflow

### Setup

```bash
npm run setup  # Installs root, server, and client dependencies
```

### Development

```bash
npm run dev    # Runs server (port 8080) + client dev server (port 5173)
```

- Server: `http://localhost:8080`
- Client dev: `http://localhost:5173` (proxies `/socket.io`, `/api`, `/health` to server)
- Hot reload enabled for both

### Build

```bash
npm run build  # Builds client, copies to server/public
npm start      # Runs production server
```

### Health Check

`GET /health` returns `200` JSON.

---

## Deployment (Fly.io)

### Single App Deployment

- Express serves React build from `server/public`
- Socket.IO runs on same origin/port (no CORS)
- Single Docker container
- Sticky sessions required if scaling to multiple instances (use Redis adapter)

### Commands

```bash
fly auth login
fly launch      # Use existing Dockerfile and fly.toml
fly deploy
fly open
```

---

## Key Implementation Notes

### Clue Visibility Logic

During `"clues"` phase, `publicLobbyState()` filters `cluesByPlayerId` to show only the requesting player's clue. During voting/fraud_guess/round_results phases, all clues are visible.

### Fraud Guess Flow

Instead of a popup modal, Fraud uses the existing clue board:
- Tiles become clickable when `phase === "fraud_guess" && !isDetective`
- Selected tile highlighted
- Submit/Skip buttons below board
- Simpler, more integrated UX

### Role Reveal

Two-step modal per round:
1. "Ready to see your role?" → Click "Reveal My Role"
2. Role reveal → Countdown (4s) → "Start Playing"
- Per-player state (not synchronized)
- Resets on round change
- Detectives don't see secret until after reveal

### Lobby Name vs Lobby Code

- **Lobby Name**: Human-friendly, display-only, NOT secret
- **Lobby Code**: Auto-generated 6-char secret, ONLY secret for joining
- Public lobbies: Join by ID (no code needed)
- Private lobbies: Join by code only (not in list)

### Round Results

After voting/fraud guess, server emits `ROUND_ENDED` with comprehensive results:
- Fraud won/lost status
- Majority vote boolean
- Fraud identities (IDs + names)
- Correct secret word
- Fraud guess result (correct/incorrect, guessed word)
- Winner (if game ended)

Clients show results modal, host can start next round or end game.

---

## Testing Considerations

### Manual Testing Checklist

- [ ] Create public lobby → appears in list
- [ ] Create private lobby → not in list, requires code
- [ ] Join by code works
- [ ] Host transfer works
- [ ] Game start → all players see round
- [ ] Role reveal appears each round
- [ ] Clue submission (only own clue visible in clues phase)
- [ ] Vote to start voting (50% threshold)
- [ ] Voting → all votes → fraud guess prompt (if survived)
- [ ] Fraud guess → results modal
- [ ] Round results → next round or end game
- [ ] Scoring updates correctly
- [ ] Game ends at 10 points
- [ ] Host disconnect → host reassigned
- [ ] Chat works
- [ ] Settings updates (host only)

### Known Limitations

- In-memory state (resets on server restart)
- Single instance only (requires Redis adapter for scaling)
- No persistence (games don't survive restarts)
- No authentication (client IDs stored in localStorage)

---

## Future Enhancement Ideas

- Custom categories (UI removed, logic exists)
- Time limits (settings exist, not implemented)
- Spectator mode
- Game history/replays
- Mobile app
- Authentication system
- Database persistence
- Multi-instance scaling (Redis adapter)

---

This system prompt provides a complete overview of The Fraud application architecture, game mechanics, socket events, data structures, and implementation details. Use this as a reference when working on the codebase or starting a new project based on this design.
