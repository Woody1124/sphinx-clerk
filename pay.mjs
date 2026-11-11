// The payment tool for AI agents (and anyone with a Qbit seed). It pays the sale price with the sealed answer, and later sends the reveal.
//   node pay.mjs seal <commit> [--rate 4] [--send]     (the seed goes to the paying address; a memo with a second address would not fit in 80 bytes)
//   node pay.mjs reveal <commit> <nonce> "<answer>" [--rate 4] [--send]
// The seed comes from the QBIT_SEED variable or --seed-file <path> (never a command-line word). The sale facts (sales address, price, window)
// come from the riddle API (/info, SX_API). Without --send it only shows the plan. Coins that carry an inscription or a rune are never spent.
import { readFileSync } from "node:fs";
import { net, api, log, qbt, sleep, P, pqc, walletFromSeed, floatCoins, broadcast, hex, unhex } from "./clerk/chain.mjs";

const V = P.P2MR_LEAF_VERSION_V1, DUST = 10_000n;
export const memoScript = (memo) => { const b = Buffer.from(memo); if (b.length > 80) throw new Error("the memo is longer than 80 bytes"); return Uint8Array.from([0x6a, ...(b.length > 75 ? [0x4c] : []), b.length, ...b]); };

// Builds, signs and (with send) broadcasts a payment of `value` bits to `to` with an OP_RETURN memo. Returns { txid, fee, raw }.
export async function payWithMemo(w, { to, value, memo, rate = 4, send = false }) {
  P.decodeP2mrAddress(to, net.network); value = BigInt(value);
  const build = (coins, fee) => {
    const total = coins.reduce((s, u) => s + BigInt(u.value), 0n), change = total - value - fee;
    const outputs = [{ value, scriptPubKey: P.addressToScriptPubKey(to, net.network) }, { value: 0n, scriptPubKey: memoScript(memo) }];
    if (change >= DUST) outputs.push({ value: change, scriptPubKey: w.script });
    const psbt = P.createP2mrPsbt({ version: 2, locktime: 0, inputs: coins.map((u) => ({ prevout: { txid: unhex(u.txid).reverse(), vout: u.vout }, witnessUtxo: { value: BigInt(u.value), scriptPubKey: w.script }, controlBlock: w.control, leafScript: w.leafScript, leafVersion: V, merkleRoot: w.leafHash, sequence: 0xfffffffd })), outputs });
    const signed = P.signP2mrPsbt({ psbt, keys: coins.map((_, inputIndex) => ({ inputIndex, pubkey: w.key.pk32, leafHash: w.leafHash })), sign: (h) => pqc.sign(w.key.sk64, h) });
    return { raw: P.extractP2mrTransaction(P.finalizeP2mrPsbt(signed.psbt)), change };
  };
  let fee = BigInt(Math.ceil(rate * 1100)), coins = (await floatCoins(w.address, { need: value + fee + DUST })).picked;
  const have = (cs) => cs.reduce((s, u) => s + BigInt(u.value), 0n);
  if (have(coins) < value + fee) throw new Error(`not enough plain coins at ${w.address}: need ${qbt(value + fee)} QBT, usable ${qbt(have(coins))}`);
  let b = build(coins, fee);                                              // the first pass tells the real size, the second pays the right fee
  fee = BigInt(Math.ceil(rate * Math.ceil(b.raw.length / 4))); if (have(coins) < value + fee + DUST) coins = (await floatCoins(w.address, { need: value + fee + DUST, max: 8 })).picked;
  if (have(coins) < value + fee) throw new Error(`not enough plain coins: need ${qbt(value + fee)} QBT, usable ${qbt(have(coins))}`);
  b = build(coins, fee);
  const out = { fee, raw: b.raw, bytes: b.raw.length, from: w.address, to, value, memo, inputs: coins.length };
  if (!send) return out; return { ...out, txid: await broadcast(hex(b.raw)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), cmd = args[0], opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d), send = args.includes("--send"), rate = +opt("--rate", "4");
  try {
    const seed = process.env.QBIT_SEED || (opt("--seed-file") ? readFileSync(opt("--seed-file"), "utf8").trim() : ""); if (!seed) throw new Error("set QBIT_SEED or pass --seed-file <path>");
    const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--rate", "--seed-file"].includes(args[i - 1]))).slice(1);
    const info = await (await fetch((process.env.SX_API || "https://sphinx-riddles.sphinxseeds.workers.dev") + "/info")).json(); if (!info.salesAddress) throw new Error("the sale has not been announced: " + JSON.stringify(info));
    const w = await walletFromSeed(seed), tip = +(await api("/blocks/tip/height")); let memo, value;
    if (cmd === "seal") { const [commit] = pos; if (!/^[0-9a-f]{16}$/.test(commit || "")) throw new Error("usage: pay.mjs seal <commit: 16 hex>"); memo = `SX1|${commit}`; value = BigInt(info.priceBits);
      if (tip < info.saleStartBlock || tip > info.saleEndBlock) throw new Error(`the sale is not open now (block ${tip}; it runs from ${info.saleStartBlock} to ${info.saleEndBlock})`); }
    else if (cmd === "reveal") { const [commit, nonce, answer] = pos; if (!/^[0-9a-f]{16}$/.test(commit || "") || !/^[0-9a-f]{16}$/.test(nonce || "") || !answer) throw new Error('usage: pay.mjs reveal <commit> <nonce> "<answer>"'); memo = `SX2|${commit}|${nonce}|${answer.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()}`; value = DUST; }
    else throw new Error('usage: pay.mjs seal <commit> | reveal <commit> <nonce> "<answer>"  [--rate 4] [--send]');
    const r = await payWithMemo(w, { to: info.salesAddress, value, memo, rate, send });
    log(`${cmd}: ${qbt(r.value)} QBT from ${r.from.slice(0, 14)}… to the sales address ${r.to.slice(0, 14)}… memo "${r.memo}", fee ${qbt(r.fee)} QBT, ${r.inputs} coin(s), ${r.bytes} bytes`);
    if (!send) log("plan only, nothing sent. Add --send."); else { log("sent", r.txid); for (;;) { await sleep(5000); const s = await api(`/tx/${r.txid}/status`).catch(() => ({})); if (s.confirmed) { log("confirmed in block", s.block_height); break; } } }
  } catch (e) { console.error("pay:", e.message); process.exitCode = 1; }
}
