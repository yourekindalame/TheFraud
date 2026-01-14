# Implementation Plan: The Fraud Game

## Overview
This document outlines the phased implementation plan to complete all requirements for "The Fraud" game.

## Phase 1: Core Game Flow Fixes ✅ (COMPLETED)
**Priority: Critical - These fix fundamental game mechanics**

1. ✅ Fix workspace naming (COMPLETED)
   - server/package.json: name = "server"
   - client/package.json: name = "client"
   - root package.json: workspaces array

2. ✅ Fix role reveal flow (COMPLETED)
   - Step A: "Ready to see your role?" → Click "Reveal My Role" → Wait 3 seconds (countdown) → Auto-proceed
   - Step B: Role reveal modal → Continue button with 3-second countdown → Auto-closes after 3 seconds (or click to close)

3. ✅ Verify end voting early (3-second hold) (COMPLETED)

4. ✅ Clues panel shows all clues during clues phase (COMPLETED)

## Phase 2: Voting Improvements ✅ (COMPLETED)
**Priority: High - Core gameplay feature**

1. ✅ Change voting to click player name directly (COMPLETED)
   - Removed "Submit Vote" button
   - Click player name to vote immediately
   
2. ✅ Show voter indicators next to voted players (COMPLETED)
   - Display first letter of voter names
   - Visible to all players (unless anonymous voting)

## Phase 3: Fraud Guess Flow ⏳ (PENDING)
**Priority: High - Completes game round flow**

1. Add 1-minute timer for fraud guess phase
   - Timer visible to fraud player
   - Auto-submit null guess if timer expires

2. Emit FRAUD_GUESS_RESULT event
   - Server emits to all players
   - Include: isCorrect, guessIndex, secretIndex

3. Auto-start next round after 10 seconds
   - After FRAUD_GUESS_RESULT is broadcast
   - Wait 10 seconds, then start new round automatically
   - Reset clues panel

## Phase 4: Profile Image Upload ⏳ (PENDING)
**Priority: Medium - UX enhancement**

1. Add profile image upload feature
   - Upload button in header (near rules)
   - Store image data in localStorage
   - Display in header (top-right area)

## Phase 5: Documentation & Polish ⏳ (PENDING)
**Priority: Low - Final touches**

1. Update README with correct deployment instructions
2. Verify all acceptance tests pass
3. Final code review and cleanup

---

## Current Status
- ✅ Phase 1: Core Game Flow Fixes (COMPLETED)
- ✅ Phase 2: Voting Improvements (COMPLETED)
- ⏳ Phase 3: Fraud Guess Flow (PENDING)
- ⏳ Phase 4: Profile Image Upload (PENDING)
- ⏳ Phase 5: Documentation & Polish (PENDING)
