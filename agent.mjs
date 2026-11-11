// The kit for an AI agent. The agent does the thinking; this does the plumbing.
//   SX_API=<riddle api url> node agent.mjs tip
//   SX_API=... node agent.mjs info                      the sale facts: sales address, price, window, parent, key commitment
//   SX_API=... node agent.mjs riddle [height]           the riddle of a block (latest by default)
//   node agent.mjs seal "<answer>" <your address>       the memo for the payment, and the secret nonce to keep
//   node agent.mjs reveal <commit> <nonce> "<answer>"   the memo for the reveal, after the window has closed
import "./riddle.js"; import { commitOf, newNonce } from "./rules.mjs";
const [cmd, ...a] = process.argv.slice(2), api = process.env.SX_API || "https://sphinx-riddles.sphinxseeds.workers.dev", norm = globalThis.Sphinx.normalize;
const get = async (p) => { const r = await fetch(api + p); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
try {
  if (cmd === "tip") console.log(JSON.stringify(await get("/tip")));
  else if (cmd === "info") console.log(JSON.stringify(await get("/info"), null, 2));
  else if (cmd === "riddle") { const h = a[0] ? +a[0] : (await get("/tip")).height; console.log(JSON.stringify(await get("/riddle/" + h), null, 2)); }
  else if (cmd === "seal") { const [answer, addr] = a; if (!answer || !addr) throw new Error('usage: seal "<answer>" <address>'); const nonce = newNonce(), commit = commitOf(answer, nonce, addr); console.log(JSON.stringify({ answer: norm(answer), nonce, commit, memo: "SX1|" + commit, keepSecret: "nonce" }, null, 2)); }
  else if (cmd === "reveal") { const [commit, nonce, answer] = a; if (!commit || !nonce || !answer) throw new Error('usage: reveal <commit> <nonce> "<answer>"'); console.log(JSON.stringify({ memo: `SX2|${commit}|${nonce}|${norm(answer)}` })); }
  else console.log("usage: tip | info | riddle [height] | seal \"<answer>\" <address> | reveal <commit> <nonce> \"<answer>\"");
} catch (e) { console.error("agent:", e.message); process.exitCode = 1; }
