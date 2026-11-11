// The rules the clerk applies. Two secrets keep this a game for minds, not for scripts:
//  1. The riddle of block h is built from HMAC(epochSecret, blockhash(h)) and the generator code is never published. A script that imports
//     a public generator would simply read the answer; here nobody but the riddle server and the clerk can compute it. The epoch secret is
//     committed to up front (its hash is in the parent) and revealed when the epoch ends, so anyone can re-check every verdict afterwards.
//  2. Two phases so nobody can copy an answer from the mempool:
//       phase 1: pay the price with memo "SX1|<commit>", commit = first 16 hex of sha256("SX1|"+answer+"|"+nonce+"|"+address)
//       phase 2: after the window closes, a small transaction with memo "SX2|<commit>|<nonce>|<answer>" (the reveal)
// A payment is never lost: with no reveal, or a wrong one, the payer still gets a seed, but a sealed one. A right answer always blooms.
import { createHash, createHmac, randomBytes } from "node:crypto";
import "./riddle.js";
const S = globalThis.Sphinx;
export const CAP = 3333, PRICE_BITS = 300000000; // 3 333 seeds, 3 QBT each (1 QBT = 1e8 bits)
export const WINDOW = 3;            // a commit confirmed at height h may answer the riddle of block h-1, h-2 or h-3
export const REVEAL_BLOCKS = 360;   // six hours to reveal (an agent does it in minutes); after that the seed is minted sealed
export const sha = (s) => createHash("sha256").update(s).digest("hex");
export const newNonce = () => randomBytes(8).toString("hex");
export const commitOf = (answer, nonce, addr) => sha(`SX1|${S.normalize(answer)}|${nonce}|${addr}`).slice(0, 16);
export const epochCommit = (secret) => sha("SX-epoch|" + secret);
export const seedOf = (secret, blockHash) => createHmac("sha256", secret).update("SX1|" + blockHash).digest("hex");
export const riddleFor = (secret, blockHash) => S.riddle(seedOf(secret, blockHash));

// reveal: { answer, nonce } or null. blockHash(h) gives the hash of block h. revealHeight (optional) is the block the reveal was confirmed in:
// a reveal is only counted once the window of the riddle it answers has closed (otherwise a copier could still use it), `early: true` says
// "ignore this one, a later reveal may still count". A reveal that matches the commitment but is wrong is final: the commitment binds the answer.
export function decide({ commit, reveal, addr, commitHeight, blockHash, secret, revealHeight }) {
  if (!reveal) return { solved: false, reason: "no reveal" };
  const a = S.normalize(reveal.answer);
  if (commitOf(a, reveal.nonce, addr) !== commit) return { solved: false, reason: "the reveal does not match the commitment", junk: true };
  for (let k = 1; k <= WINDOW; k++) { const R = riddleFor(secret, blockHash(commitHeight - k)); if (R.answer === a) {
    if (revealHeight != null && revealHeight <= commitHeight - k + WINDOW) return { solved: false, reason: "revealed while the window was still open", early: true };
    return { solved: true, speed: k, family: R.family, riddleBlock: commitHeight - k }; } }
  return { solved: false, reason: "wrong answer or too late" };
}

// The drop. The rune is created once, after the garden closes, with its whole supply premined to the owner, and then handed out.
// Its supply is K per bloomed seed: sealed seeds add nothing (the runes they would have carried are never created).
// A bloomed seed weighs 3, 2 or 1 by its speed (+2 for first light); shares are whole runes, the remainder goes to the largest fractions.
export const weightOf = ({ speed, first }) => ({ 1: 3, 2: 2, 3: 1 }[speed] || 0) + (first ? 2 : 0);
export function shares(seeds, supply) {
  const w = seeds.map(weightOf), total = w.reduce((a, b) => a + b, 0); if (!total) return seeds.map(() => 0n);
  const S = BigInt(supply), W = BigInt(total), base = w.map((x) => (S * BigInt(x)) / W);
  let left = S - base.reduce((a, b) => a + b, 0n);
  const order = w.map((x, i) => [i, (S * BigInt(x)) % W]).sort((a, b) => (a[1] === b[1] ? a[0] - b[0] : a[1] > b[1] ? -1 : 1));
  for (const [i] of order) { if (left <= 0n) break; base[i] += 1n; left -= 1n; }
  return base;
}
