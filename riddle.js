// SPHINX riddles: a short story built from a block hash, with a question whose answer follows from the text alone.
// Deterministic: the same hash gives the same riddle in a browser, in Node and in the clerk. No dependencies.
// riddle(hex) -> { family, text, labels:[3], tokens:[3], answer:"a b c" }
(function () {
  const NAMES = [["Mira","f"],["Tomas","m"],["Ilse","f"],["Bram","m"],["Odile","f"],["Kasper","m"],["Neva","f"],["Lucan","m"],["Sabine","f"],["Orsin","m"],["Wren","f"],["Dorian","m"],["Petra","f"],["Evander","m"],["Calla","f"],["Rufus","m"],["Linnea","f"],["Anselm","m"],["Thea","f"],["Cormac","m"],["Yara","f"],["Felix","m"],["Greta","f"],["Hugo","m"]];
  const ROOMS = ["cellar","attic","kitchen","library","garden","tower","workshop","chapel","stable","boathouse","greenhouse","observatory"];
  const OBJECTS = [{k:"key",d:"brass key"},{k:"letter",d:"sealed letter"},{k:"lantern",d:"old lantern"},{k:"compass",d:"silver compass"},{k:"violin",d:"cracked violin"},{k:"map",d:"folded map"},{k:"ring",d:"jade ring"},{k:"clock",d:"pocket clock"}];
  const WORDS = ["harbor","lantern","meadow","thunder","crystal","orchard","compass","glacier","whisper","anchor","ember","falcon","marble","velvet","copper","saffron","tundra","willow","cinder","mirror","pillar","sparrow","quartz","ribbon","summit","timber","violet","walnut","zephyr","bridge","candle","dagger","feather","garnet","hollow","island","jasmine","kettle","lagoon","magnet"];
  const ORD = ["first","second","third","fourth","fifth","sixth"];
  function xmur3(s) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return (h ^= h >>> 16) >>> 0; }; }
  function sfc32(a, b, c, d) { return () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = (c << 21 | c >>> 11); d = d + 1 | 0; t = t + d | 0; c = c + t | 0; return (t >>> 0) / 4294967296; }; }
  function rng(seed) {
    const s = xmur3(seed), f = sfc32(s(), s(), s(), s()); for (let i = 0; i < 15; i++) f();
    const R = { f, int: (a, b) => a + Math.floor(f() * (b - a + 1)), pick: (x) => x[Math.floor(f() * x.length)], chance: (p) => f() < p };
    R.shuffle = (x) => { x = x.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
    R.sample = (x, n) => R.shuffle(x).slice(0, n); return R;
  }
  const list = (a) => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  const up = (s) => s[0].toUpperCase() + s.slice(1);

  // ---- family 1: who carries what, where: people move, pick up, hand over and put down things
  function tracking(R) { for (let attempt = 0; ; attempt++) { const r = tracking1(R); if (r.hands >= 3 || attempt > 80) return r; } }
  function tracking1(R) {
    const P = R.sample(NAMES, 5).map(([n, g]) => ({ n, g })), O = R.sample(OBJECTS, 4), rooms = R.sample(ROOMS, 5);
    const at = {}, hold = {}, lie = {}, hand = {};
    P.forEach((p) => { at[p.n] = R.pick(rooms); }); O.forEach((o) => { hold[o.k] = null; lie[o.k] = R.pick(rooms); hand[o.k] = 0; });
    const loc = (o) => hold[o.k] ? at[hold[o.k]] : lie[o.k];
    const out = [`Five people spend an evening in an old house. Its rooms are: ${list(rooms)}. At the start, ${list(P.map((p) => `${p.n} is in the ${at[p.n]}`))}. ${up(list(O.map((o) => `the ${o.d} lies in the ${lie[o.k]}`)))}.`];
    const noise = ["Rain tapped on the windows.", "A clock somewhere struck an hour nobody noticed.", "The wind rattled the shutters.", "Someone, far away, was humming an old tune.", "A cat crossed the corridor and left again."];
    let la = null, lo = null;
    const sub = (p) => (la === p.n && R.chance(0.6) ? (p.g === "f" ? "She" : "He") : p.n);
    const obj = (o, p) => (la === p.n && lo === o.k && R.chance(0.7) ? "it" : "the " + o.d);
    for (let e = 0, n = R.int(26, 34); e < n; e++) {
      for (let tries = 0; tries < 40; tries++) {
        const t = R.pick(["pick", "pick", "give", "give", "give", "move", "move", "drop", "noise"]), p = R.pick(P);
        if (t === "noise") { out.push(R.pick(noise)); la = lo = null; break; }
        if (t === "pick") { const c = O.filter((o) => hold[o.k] === null && lie[o.k] === at[p.n]); if (!c.length) continue; const o = R.pick(c); const s = sub(p); hold[o.k] = p.n; out.push(R.pick([`${s} picked up the ${o.d}.`, `${s} took the ${o.d} from where it lay.`])); la = p.n; lo = o.k; break; }
        if (t === "give") { const c = O.filter((o) => hold[o.k] === p.n), q = P.filter((x) => x.n !== p.n && at[x.n] === at[p.n]); if (!c.length || !q.length) continue; const o = R.pick(c), r = R.pick(q); const s = sub(p), w = obj(o, p); hold[o.k] = r.n; hand[o.k]++; out.push(R.pick([`${s} handed ${w} to ${r.n}.`, `${s} gave ${w} to ${r.n}, who put it in a bag.`, `${s} passed ${w} over to ${r.n}.`])); la = p.n; lo = o.k; break; }
        if (t === "move") { const r = R.pick(rooms.filter((x) => x !== at[p.n])); const s = sub(p); at[p.n] = r; out.push(R.pick([`${s} walked into the ${r}.`, `${s} left for the ${r}.`, `${s} went down the hall to the ${r}.`])); la = p.n; lo = null; break; }
        if (t === "drop") { const c = O.filter((o) => hold[o.k] === p.n); if (!c.length) continue; const o = R.pick(c); const s = sub(p), w = obj(o, p); lie[o.k] = at[p.n]; hold[o.k] = null; out.push(R.pick([`${s} put ${w} down and left it there.`, `${s} set ${w} on a table and let go of it.`])); la = p.n; lo = o.k; break; }
      }
    }
    let T = O[0]; for (const o of O) if (hand[o.k] > hand[T.k]) T = o;
    const holder = hold[T.k] || "nobody";
    return { story: out.join(" "), q: `Where is the ${T.d} at the end? Who is carrying it (answer "nobody" if it simply lies somewhere)? How many times was it handed from one person directly to another?`, labels: ["room", "name or nobody", "number"], tokens: [loc(T), holder.toLowerCase(), String(hand[T.k])], hands: hand[T.k] };
  }

  // ---- family 2: purses: payments, finds, losses, halving, doubling, swaps
  function coins(R) {
    for (let attempt = 0; ; attempt++) {
      const P = R.sample(NAMES, 5).map(([n]) => n), c = {}, out = []; P.forEach((p) => { c[p] = R.int(6, 40); });
      out.push(`Five friends count their coins before a market day. ${list(P.map((p) => `${p} has ${c[p]}`))}.`);
      const ev = [];
      for (let e = 0, n = R.int(17, 24); e < n; e++) for (let tries = 0; tries < 40; tries++) {
        const t = R.pick(["pay", "pay", "find", "lose", "half", "double", "swap"]), a = R.pick(P), b = R.pick(P.filter((x) => x !== a));
        if (t === "pay") { const m = R.int(1, Math.min(25, c[a])); if (c[a] < 1) continue; c[a] -= m; c[b] += m; out.push(R.pick([`${a} paid ${b} ${m} coin${m > 1 ? "s" : ""} for a favour.`, `${b} was paid ${m} coin${m > 1 ? "s" : ""} by ${a} for mending a cart.`])); break; }
        if (t === "find") { const m = R.int(2, 20); c[a] += m; out.push(`${a} found ${m} coin${m > 1 ? "s" : ""} under a stone.`); break; }
        if (t === "lose") { if (c[a] < 2) continue; const m = R.int(1, Math.min(15, c[a])); c[a] -= m; out.push(`${a} lost ${m} coin${m > 1 ? "s" : ""} through a hole in a pocket.`); break; }
        if (t === "half") { if (c[a] < 2 || c[a] % 2) continue; c[b] += c[a] / 2; c[a] /= 2; out.push(`${a} gave exactly half of their coins to ${b}.`); break; }
        if (t === "double") { if (c[a] > 120 || c[a] < 1) continue; c[a] *= 2; out.push(`${a} sold a painting for exactly as much as they already carried, doubling their purse.`); break; }
        if (t === "swap") { [c[a], c[b]] = [c[b], c[a]]; out.push(`${a} and ${b} swapped purses by mistake and noticed too late.`); break; }
      }
      const max = Math.max(...P.map((p) => c[p])); if (P.filter((p) => c[p] === max).length > 1 && attempt < 50) continue;
      const T = R.pick(P), rich = P.find((p) => c[p] === max), tot = P.reduce((s, p) => s + c[p], 0);
      return { story: out.join(" "), q: `Who has the most coins at the end? How many coins does ${T} have? How many coins do the five friends have all together?`, labels: ["name", "number", "number"], tokens: [rich.toLowerCase(), String(c[T]), String(tot)] };
    }
  }

  // ---- family 3: a queue described by clues; the clues are added until exactly one order fits (checked by brute force)
  function perms(a) { if (a.length < 2) return [a]; const r = []; a.forEach((x, i) => perms(a.slice(0, i).concat(a.slice(i + 1))).forEach((p) => r.push([x].concat(p)))); return r; }
  function order(R) {
    const P = R.sample(NAMES, 6).map(([n]) => n), truth = R.shuffle(P), pos = (p, a) => a.indexOf(p) + 1;
    const mk = () => { const a = R.pick(P), b = R.pick(P.filter((x) => x !== a)), c = R.pick(P.filter((x) => x !== a && x !== b)), k = R.int(1, 6), t = R.int(0, 6);
      if (t === 0) return { txt: `${a} stands ${ORD[k - 1]} from the left.`, ok: (o) => pos(a, o) === k };
      if (t === 1) return { txt: `${a} is somewhere to the left of ${b}.`, ok: (o) => pos(a, o) < pos(b, o) };
      if (t === 2) return { txt: `${a} stands immediately to the right of ${b}.`, ok: (o) => pos(a, o) === pos(b, o) + 1 };
      if (t === 3) return { txt: `${a} and ${b} are neighbours.`, ok: (o) => Math.abs(pos(a, o) - pos(b, o)) === 1 };
      if (t === 4) return { txt: `${a} and ${b} are not neighbours.`, ok: (o) => Math.abs(pos(a, o) - pos(b, o)) > 1 };
      if (t === 5) return { txt: `${b} stands somewhere between ${a} and ${c}.`, ok: (o) => (pos(a, o) < pos(b, o) && pos(b, o) < pos(c, o)) || (pos(c, o) < pos(b, o) && pos(b, o) < pos(a, o)) };
      return { txt: `${a} does not stand ${ORD[k - 1]} from the left.`, ok: (o) => pos(a, o) !== k }; };
    const all = perms(P); let clues = [], left = all;
    for (let i = 0; i < 700 && left.length > 1; i++) { const c = mk(); if (!c.ok(truth)) continue; const n = left.filter(c.ok); if (n.length < left.length) { clues.push(c); left = n; } }
    clues = R.shuffle(clues);
    const stated = clues.filter((c) => / stands \w+ from the left\.$/.test(c.txt) && !/not stand/.test(c.txt)).map((c) => c.txt.split(" ")[0]);
    const mid = P.filter((p) => !stated.includes(p) && p !== truth[0] && p !== truth[5]), T = R.pick(mid.length ? mid : P.filter((p) => p !== truth[0] && p !== truth[5]));
    const frame = R.pick(["Six travellers wait in a single line at the ferry.", "Six students line up in a row in front of a locked door.", "Six musicians stand in a row on a narrow stage."]);
    return { story: `${frame} They are ${list(P)}, in an order you must work out. ${clues.map((c) => c.txt).join(" ")}`, q: `Who stands first from the left? Who stands last, at the far right? At which place from the left (a number from 1 to 6) does ${T} stand?`, labels: ["name", "name", "number"], tokens: [truth[0].toLowerCase(), truth[5].toLowerCase(), String(pos(T, truth))], _solutions: left.length };
  }

  // ---- family 4: a plaque in a shifted alphabet; the shift hides in a description of doors
  function cipher(R) {
    const w = R.pick(WORDS), a = R.int(1, 5), b = R.int(1, 6), c = R.int(1, 5), k = a + c;
    const total = a + b + c, back = total % 2 === 1;
    let enc = w.split("").map((ch) => String.fromCharCode(97 + (ch.charCodeAt(0) - 97 + k) % 26)).join("").toUpperCase(); if (back) enc = enc.split("").reverse().join("");
    const doors = R.shuffle([[a, "red"], [b, "blue"], [c, "green"]]).map(([n, col]) => `${n} ${col} door${n > 1 ? "s" : ""}`);
    const story = `At the end of a long corridor a plaque reads "${enc}". The caretaker explains: "Every letter was pushed forward in the alphabet by as many places as there are doors in this corridor that are not blue. To read the plaque, move each letter back by that many places, and wrap around the end of the alphabet if you must. If the total number of doors in the corridor is odd, the plaque was also carved backwards, so read it from the right first." The corridor has ${list(doors)}. ${R.pick(["Two lamps flicker overhead.", "The floor smells of wax.", "A draught moves the dust."])}`;
    return { story, q: `Which word is on the plaque? By how many places was each letter pushed? How many doors does the corridor have in total?`, labels: ["word", "number", "number"], tokens: [w, String(k), String(total)] };
  }

  const FAMILIES = [["tracking", tracking], ["coins", coins], ["order", order], ["cipher", cipher]];
  const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  function riddle(hex) {
    const R = rng("SX1|riddle|" + hex), [family, fn] = FAMILIES[R.int(0, 3)], r = fn(R);
    return { family, text: `${r.story}\n\n${r.q}\n\nReply with exactly three words or numbers separated by spaces, in this order: ${r.labels.join(", ")}.`, labels: r.labels, tokens: r.tokens, answer: r.tokens.join(" "), _solutions: r._solutions };
  }
  globalThis.Sphinx = { riddle, normalize, rng, FAMILIES: FAMILIES.map((f) => f[0]) };
})();
