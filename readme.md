# The Fraud

Production-ready, web-based multiplayer deduction game.

- **Backend**: Node.js + Express + Socket.IO (authoritative server state)
- **Frontend**: Vite + React + TypeScript
- **Deploy**: Single Fly.io app (Express serves the React build; Socket.IO on same origin/port)

## Repo structure

- `server/` Express + Socket.IO
- `client/` Vite React + TS
- Root scripts to run both

## Local development

### Prereqs

- Node.js 20+ (works with Node 22)

### Install

```bash
npm run setup
```

### Run dev (two processes)

```bash
npm run dev
```

- Server: `http://localhost:8080`
- Client dev server: `http://localhost:5173` (proxies `/socket.io`, `/api`, `/health` to the server)

### Build production bundle locally

```bash
npm run build
npm start
```

Open: `http://localhost:8080` (Express serves the built client from `server/public`).

### Health check

`GET /health` returns `200` JSON.

## Game overview (MVP)

- Create a lobby (optional passcode lock)
- Join lobbies by list or “Lobby Name” (the 6-char lobby code)
- Host can start with **0+ players**
- Category selection is shown as big buttons (only host can select)
- Game round shows a **4×4 clue board** with a hidden secret index
  - Detectives see the secret highlighted
  - Frauds do **not**
- Chat during the round
- Voting:
  - players vote by selecting a player
  - when all votes are in, or host ends early, results reveal
  - **End voting early** requires **click-and-hold 5s**
- Fraud guess:
  - if Fraud survives, they can guess the secret clue
  - **Skip** requires **click-and-hold 5s**
- Scoring:
  - Detectives eliminate The Fraud: +1 point each
  - The Fraud survives a vote: +1 point (each surviving fraud)
  - The Fraud guesses the word: +1 bonus point

## Rules (in-game modal)

🕵️ How to Play The Fraud  
One of you is lying. Everyone else is a Detective. Figure out who doesn’t belong.

🔍 Setup  
Players join a lobby. The Host selects categories and settings.  
Most players receive the same secret word.  
One (or more) players are The Fraud and don’t know the word.

🗣️ Give Clues  
Players take turns giving one-word clues.  
Detectives give clear clues that show they know the word.  
The Fraud gives vague but believable clues to blend in.

🗳️ Discuss & Vote  
Talk it out. Vote for who you think is The Fraud.  
If The Fraud is eliminated: Detectives win.  
If an innocent is eliminated: The Fraud gets one last chance.

🎯 Final Guess  
If still alive, The Fraud can guess the secret word.  
Correct guess = bonus points.

🧮 Scoring  
Detectives eliminate The Fraud: +1 point each  
The Fraud survives a vote: +1 point  
The Fraud guesses the word: +1 bonus point

🧠 Pro Tips  
Watch for generic clues. Notice hesitation and overthinking.  
Fraud tip: listen closely and mirror others.

## Socket.IO event contract (implemented)

Client → Server:

- `LOBBY_CREATE { lobbyName, passcode?, settingsDefaults }`
- `LOBBY_LIST_REQUEST {}`
- `LOBBY_JOIN { lobbyId, passcode?, playerName, clientPlayerId }`
- `LOBBY_LEAVE { lobbyId }`
- `SETTINGS_UPDATE { lobbyId, partialSettings }` (host only)
- `GAME_START { lobbyId }` (host only)
- `CHAT_SEND { lobbyId, message }`
- `VOTE_SUBMIT { lobbyId, targetPlayerId }`
- `VOTING_END_EARLY { lobbyId }` (host only, hold-to-confirm in UI)
- `FRAUD_GUESS { lobbyId, guessIndex }` (guessIndex `null` = skip; hold-to-confirm in UI)
- `ROUND_END { lobbyId }` (host only, hold-to-confirm in UI)
- `HOST_TRANSFER { lobbyId, newHostPlayerId }` (host only)

Extra (small UX helper):

- `VOTING_START { lobbyId }` (host only) — transitions the server into voting phase

Server → Client:

- `LOBBY_LIST { lobbies[] }`
- `LOBBY_STATE { lobbyId, hostPlayerId, players[], settings, gameState }`
- `HOST_CHANGED { lobbyId, hostPlayerId }`
- `GAME_STARTED { lobbyId, roundId, category, clueBoard16, visibleSecretForPlayer:boolean, secretIndexIfAllowed? }`
- `CHAT_MESSAGE { lobbyId, messageObj }`
- `VOTE_STATE { lobbyId, votesByVoterId, voteCountsByTargetId, allSubmittedBoolean }`
- `VOTE_REVEAL { lobbyId, fraudIds[], resultsSummary }`
- `SCORE_UPDATE { lobbyId, leaderboard[] }`
- `ROUND_ENDED { lobbyId, nextRoundInfo? }`
- `ERROR { code, message }`

## Fly.io deployment (single app, recommended)

This repo is set up for the **simple, reliable** approach:

- Build the React client into static files
- Express serves the build
- Socket.IO runs on the **same origin/port** (no CORS headaches; WebSockets are reliable)

### 1) Install flyctl

Follow Fly.io’s install docs, then:

```bash
fly auth login
```

### 2) Launch the app

From repo root:

```bash
fly launch
```

- Choose a region
- Use the existing `Dockerfile` and `fly.toml`
- Keep it as **one app**

### 3) Deploy

```bash
fly deploy
fly open
```

### 4) Env vars / secrets

This MVP doesn’t require secrets by default, but if you add any:

```bash
fly secrets set MY_KEY="my-value"
```

### 5) Confirm health + WebSocket

- `GET /health` should return `200`
- Open the site in two tabs, join the same lobby, and verify:
  - player list updates live
  - starting a game transitions **everyone**
  - chat updates in real time

### Scaling note (important)

MVP is designed for **1 machine instance**.

If you scale to multiple machines, Socket.IO needs:

- **sticky sessions** (same client → same machine), and
- a shared adapter (e.g. **Redis**) to share rooms/state.

Without that, you’ll see “unknown session” / missing room broadcasts across instances.

## Final verification checklist (MVP)

- Joining lobby updates player list live for everyone (`LOBBY_STATE`)
- Name persists; no re-prompt on join (localStorage)
- Host “Start Game” transitions everyone (`GAME_STARTED`)
- Host disconnect → host reassigned automatically (earliest joined remaining)
- Host transfer works (`HOST_TRANSFER` → `HOST_CHANGED` + `LOBBY_STATE`)
- Voting end early requires hold 5s
- Fraud skip requires hold 5s
- Leaderboard updates (`SCORE_UPDATE`)
- Mobile usability acceptable
- Fly deploy works via documented steps

