// The SPHINX clerk: reads the payments and the reveals sent to the sales address, decides for each payment whether its seed blooms or stays
// sealed, and inscribes one child per payment with the parent as the first input of the reveal. One run does one batch and exits.
//   QBIT_SEED="..." EPOCH_SECRET=... node clerk.mjs run [--send]     (without --send: show the plan, change nothing)
//   EPOCH_SECRET=... node clerk.mjs status                            (what is paid, revealed, ready, minted; no seed needed)
// Config (env): PARENT, LIB, OWNER (the sales address), PRICE (bits), CAP, START, END (sale window, by confirming block), RATE, BATCH, CONFS
// The chain is the only state: a payment is "done" when a child of the parent carries its txid in its metadata (`pay`).
// What a payer sends to OWNER:  price with memo "SX1|<commit>[|<address for the seed>]", then, after the window, a small tx with "SX2|<commit>|<nonce>|<answer>".
import { net, api, qord, log, qbt, sleep, P, walletFromSeed, floatCoins, planBatch, buildBatch, pushWithRetry, broadcast, hex, cborDecode } from "./chain.mjs";
import "../riddle.js";
import { riddleFor, decide, WINDOW, REVEAL_BLOCKS, epochCommit } from "../rules.mjs";

const env = process.env;
export const cfgFromEnv = () => ({
  parent: env.PARENT, lib: env.LIB, owner: env.OWNER, price: BigInt(env.PRICE || "300000000"), cap: +(env.CAP || 3333),
  start: +(env.START || 0), end: +(env.END || 1e12), rate: +(env.RATE || 4), batch: +(env.BATCH || 10), confs: +(env.CONFS || 2), secret: env.EPOCH_SECRET || "", commit: env.EPOCH_COMMIT || "",
});
export const childHtml = (parent, lib) =>
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>SPHINX SEED</title><body style="margin:0;background:#04040a;overflow:hidden"><script src="/content/${lib}"></script><script>SX.child("${parent}")</script>`;

async function allPages(path) { const ids = []; for (let p = 0; ; p++) { const r = await qord(`${path}/${p}`); ids.push(...r.ids); if (!r.more) break; } return ids; }
export async function locateParent(parentId) { // where the parent is now (the viewer may lag a block: follow the spends)
  const j = await qord(`/r/inscription/${parentId}`); let [txid, vout] = j.output.split(":"); vout = +vout;
  for (let hops = 0; hops < 80; hops++) { const o = (await api(`/tx/${txid}/outspends`))[vout]; if (!o || !o.spent) break; txid = o.txid; vout = 0; }
  const t = await api(`/tx/${txid}`);
  return { id: parentId, txid, vout, value: t.vout[vout].value, confirmed: t.status?.confirmed === true, height: t.status?.block_height };
}
const hashCache = new Map(), orderCache = new Map();
export const hashAt = async (h) => { if (!hashCache.has(h)) hashCache.set(h, (await (await fetch(net.api + "/block-height/" + h)).text()).trim()); return hashCache.get(h); };
async function positions(h) { // the order of the transactions inside a block: who was first
  if (!orderCache.has(h)) { let ids = []; try { ids = await api(`/block/${await hashAt(h)}/txids`); } catch { /* the txid order is the fallback */ } orderCache.set(h, new Map(ids.map((id, i) => [id, i]))); }
  return orderCache.get(h);
}
// the memos (OP_RETURN texts) of a transaction: ours start with SX1| or SX2|; a memo of another protocol (BB1| of BLACKBODY, say) is not ours at all
const memosOf = (t) => t.vout.filter((o) => o.scriptpubkey_type === "op_return" || o.scriptpubkey?.startsWith("6a")).map((o) => Buffer.from(o.scriptpubkey, "hex").toString("latin1"));
const sxMemo = (memos) => { for (const m of memos) { const k = m.search(/SX[12]\|/); if (k >= 0) return m.slice(k); } return ""; };

// Every confirmed payment and reveal for the owner, from the explorer.
export async function readEvents(cfg, tip) {
  const pays = [], reveals = [], loose = []; let last = null;
  for (let page = 0; page < 600; page++) {
    const txs = await api(`/address/${cfg.owner}/txs${last ? "?after_txid=" + last : ""}`);
    if (!Array.isArray(txs) || !txs.length) break;
    let older = false, sawConfirmed = false;
    for (const t of txs) {
      if (!t.status?.confirmed) continue; last = t.txid; sawConfirmed = true;
      const h = t.status.block_height; if (h < cfg.start) { older = true; continue; }
      if (tip - h + 1 < cfg.confs) continue;
      const memos = memosOf(t), memo = sxMemo(memos); if (memos.length && !memo && !/SX/.test(memos.join(""))) continue; // another protocol's payment to the same address: not ours
      const sender = t.vin.find((i) => i.prevout?.scriptpubkey_address)?.prevout.scriptpubkey_address;
      const paid = t.vout.filter((o) => o.scriptpubkey_address === cfg.owner).reduce((s, o) => s + BigInt(o.value), 0n);
      const fromOwner = !sender || t.vin.every((i) => i.prevout?.scriptpubkey_address === cfg.owner);
      let m;
      if ((m = /^SX2\|([0-9a-f]{16})\|([0-9a-f]{16})\|([a-z0-9 ]{1,80})/.exec(memo))) { reveals.push({ txid: t.txid, height: h, commit: m[1], nonce: m[2], answer: m[3].trim() }); continue; }
      if (paid < cfg.price || h > cfg.end || (fromOwner && !env.ALLOW_SELF)) continue;
      let commit = null, to = sender;
      if ((m = /^SX1\|([0-9a-f]{16})(?:\|(qb1z[0-9a-z]+))?/.exec(memo))) { commit = m[1]; if (m[2]) { try { P.decodeP2mrAddress(m[2], net.network); to = m[2]; } catch { /* a bad address in the memo: keep the sender */ } } }
      else loose.push(t.txid); // paid, but no sealed answer: it still gets a seed (a sealed one), nothing is lost
      pays.push({ txid: t.txid, height: h, sender, to, commit, paid });
    }
    if (older || !sawConfirmed) break;
  }
  for (const list of [pays, reveals]) { const pos = new Map(); for (const h of new Set(list.map((x) => x.height))) pos.set(h, await positions(h)); for (const x of list) x.pos = pos.get(x.height).get(x.txid) ?? 1e9; list.sort((a, b) => a.height - b.height || a.pos - b.pos || (a.txid < b.txid ? -1 : 1)); }
  return { pays, reveals, loose };
}

// The verdict for each payment: bloomed, sealed, or not yet (waiting for a reveal that may still come).
export async function judge(cfg, pays, reveals, tip) {
  const out = [];
  for (const h of new Set(pays.map((p) => p.height))) for (let k = 1; k <= WINDOW; k++) await hashAt(h - k);
  const bh = (h) => hashCache.get(h);
  for (const p of pays) {
    const v = { ...p };
    if (!p.commit) Object.assign(v, { ready: true, solved: false, reason: "no sealed answer with the payment" });
    else {
      let fin = null;
      for (const r of reveals.filter((r) => r.commit === p.commit)) {
        const d = decide({ commit: p.commit, reveal: { answer: r.answer, nonce: r.nonce }, addr: p.to, commitHeight: p.height, blockHash: bh, secret: cfg.secret, revealHeight: r.height });
        if (d.junk || d.early) continue; fin = { ...d, given: r.answer, rv: r.txid }; break;
      }
      if (fin) Object.assign(v, { ready: true }, fin);
      else if (tip >= p.height + REVEAL_BLOCKS) Object.assign(v, { ready: true, solved: false, reason: "no reveal in time" });
      else Object.assign(v, { ready: false, solved: false, reason: "waiting for the reveal" });
    }
    out.push(v);
  }
  const firstOf = new Map(); for (const v of out) if (v.ready && v.solved && !firstOf.has(v.height)) firstOf.set(v.height, v.txid); // first right answer of its block
  for (const v of out) v.first = firstOf.get(v.height) === v.txid;
  return out;
}

export async function survey(cfg) {
  const tip = +(await api("/blocks/tip/height")), viewer = await qord("/status");
  const kids = await allPages(`/r/children/${cfg.parent}`);
  const metas = []; for (let i = 0; i < kids.length; i += 8) metas.push(...(await Promise.all(kids.slice(i, i + 8).map(async (id) => { try { const h = await qord(`/r/metadata/${id}`); return h ? cborDecode(Buffer.from(h, "hex")) : null; } catch { return null; } }))));
  const done = new Set(metas.filter((m) => m && m.pay).map((m) => m.pay));
  const ev = await readEvents(cfg, tip), all = await judge(cfg, ev.pays, ev.reveals, tip);
  const claims = all.slice(0, cfg.cap), over = all.slice(cfg.cap);                      // the first CAP payments own the seeds
  const pending = claims.filter((v) => !done.has(v.txid));
  return { tip, viewerHeight: viewer.height, kids, done, all, claims, over, pending, ready: pending.filter((v) => v.ready), loose: ev.loose, reveals: ev.reveals };
}

// the child's metadata: what its page shows (state, speed, first light, the true answer, the riddle it met, what was given)
async function metaFor(cfg, v, n) {
  const rb = v.riddleBlock ?? v.height - 1, R = riddleFor(cfg.secret, await hashAt(rb));
  return { name: `SPHINX SEED #${n}`, n, pay: v.txid, state: v.solved ? "bloomed" : "sealed", tier: v.solved ? v.speed : 0, first: v.first ? 1 : 0, ans: R.answer, rb, fam: R.family, given: v.given || "", rv: v.rv || "", riddle: R.text };
}

export async function run({ send }) {
  const cfg = cfgFromEnv();
  for (const k of ["parent", "lib", "owner"]) if (!cfg[k]) throw new Error(`${k.toUpperCase()} is not set`);
  if (!cfg.secret) throw new Error("EPOCH_SECRET is not set"); P.decodeP2mrAddress(cfg.owner, net.network);
  if (cfg.commit && epochCommit(cfg.secret) !== cfg.commit) throw new Error("EPOCH_SECRET does not match the key commitment published in the parent: refusing to judge anyone with the wrong key");
  const w = await walletFromSeed(env.QBIT_SEED || "");
  const holder = (await qord(`/r/inscription/${cfg.parent}`)).address;
  if (holder !== w.address) throw new Error(`QBIT_SEED is the key of ${w.address.slice(0, 14)}…, but the parent is held by ${String(holder).slice(0, 14)}…`);
  const s = await survey(cfg);
  log(`tip ${s.tip}, viewer ${s.viewerHeight}, minted ${s.kids.length}/${cfg.cap}, paid ${s.all.length}, reveals ${s.reveals.length}, ready ${s.ready.length}, waiting ${s.pending.length - s.ready.length}`);
  if (s.over.length) log(`over the cap: ${s.over.length} paid after all ${cfg.cap} seeds were claimed (refund by hand): ${s.over.map((p) => p.txid.slice(0, 12)).join(" ")}`);
  if (s.loose.length) log(`${s.loose.length} payment(s) came without a sealed answer; they get sealed seeds`);
  if (s.viewerHeight < s.tip - 1) { log("the viewer is behind the chain; waiting for it"); return { busy: true }; }
  const parent = await locateParent(cfg.parent);
  if (!parent.confirmed) { log("the parent's last move is not confirmed yet; one batch at a time"); return { busy: true }; }
  if (parent.height > s.viewerHeight) { log("the viewer has not indexed the parent's last move yet"); return { busy: true }; }
  const todo = s.ready.slice(0, Math.max(0, cfg.cap - s.kids.length)).slice(0, cfg.batch);
  if (!todo.length) { log("nothing to inscribe"); return { done: true }; }
  const html = childHtml(cfg.parent, cfg.lib);
  const items = []; for (let k = 0; k < todo.length; k++) items.push({ type: "text/html;charset=utf-8", body: html, to: todo[k].to, meta: await metaFor(cfg, todo[k], s.kids.length + k + 1) });
  const label = todo.map((t) => t.txid).join(","), exclude = [`${parent.txid}:${parent.vout}`];
  let coins = (await floatCoins(w.address, { exclude, need: 0n })).picked;
  const plan = await planBatch(w, { items, parent, rate: cfg.rate, label, coins });
  const f = await floatCoins(w.address, { exclude, need: plan.need });
  if (f.sum < plan.need) throw new Error(`the collection address ${w.address} needs ${qbt(plan.need)} QBT of plain coins, has ${qbt(f.sum)}`);
  const b = buildBatch(w, plan, { coins: f.picked, parent, rate: cfg.rate });
  log(`batch of ${items.length}: #${s.kids.length + 1}..#${s.kids.length + items.length}; reveal fee ${qbt(plan.revealFee)} + commit fee ${qbt(b.commitFee)} QBT; reveal ${b.reveal.length} B`);
  items.forEach((it, k) => log(`  #${s.kids.length + k + 1} ${it.meta.state}${it.meta.tier ? " tier " + it.meta.tier : ""}${it.meta.first ? " first light" : ""} -> ${it.to.slice(0, 14)}…  for ${todo[k].txid.slice(0, 12)}`));
  if (!send) { log("dry run, nothing sent. Add --send."); return { dry: true, count: items.length, items }; }
  let commitKnown = false; try { await api(`/tx/${b.commitId}/status`); commitKnown = true; } catch { /* not known */ }
  if (!commitKnown) { const id = await pushWithRetry(hex(b.commit)); log("commit", id); if (id !== b.commitId) throw new Error(`node txid ${id} differs from ${b.commitId}`); } else log("commit already known:", b.commitId);
  const rid = await pushWithRetry(hex(b.reveal), 12); log("reveal", rid);
  return { sent: true, reveal: rid, count: items.length, items };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] || "status";
  try {
    if (cmd === "run") { const r = await run({ send: process.argv.includes("--send") }); if (r.busy) log("busy, will retry on the next run"); }
    else if (cmd === "status") { const cfg = cfgFromEnv(), s = await survey(cfg); log(`tip ${s.tip}; minted ${s.kids.length}/${cfg.cap}; paid ${s.all.length}; ready ${s.ready.length}; waiting ${s.pending.length - s.ready.length}; bloomed so far ${s.all.filter((v) => v.ready && v.solved).length}`); }
    else throw new Error("usage: clerk.mjs run [--send] | status");
  } catch (e) { console.error("clerk:", e.message); process.exitCode = 1; }
}
