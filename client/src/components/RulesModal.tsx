import { Modal } from "./Modal";

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Rules" onClose={onClose}>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
        {`🕵️ How to Play The Fraud
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
Fraud tip: listen closely and mirror others.`}
      </div>
    </Modal>
  );
}

