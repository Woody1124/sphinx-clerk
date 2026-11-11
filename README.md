# sphinx-clerk

The scheduled job of the SPHINX SEEDS collection on Qbit. Every few minutes it reads what was sent to the sale address:
a payment with a sealed answer (memo `SX1|<commit>`) and, after the riddle's window has closed, the reveal (memo `SX2|<commit>|<nonce>|<answer>`).
It checks each reveal against the riddle of that block and inscribes one seed per payment: **bloomed** for a right answer in the window,
**sealed** for anything else. A payment is never lost. The chain is the only state.

* `config.json`: public chain facts (ids, addresses, the sale window).
* `QBIT_SEED` (secret): the key of the collection address, which holds the parent inscription and a little QBT for fees.
* `EPOCH_SECRET` (secret): the riddle key of the epoch. Its hash is committed to in the parent; the key itself is published when the epoch
  ends, so anyone can re-check every verdict with `riddle.js` and `rules.mjs`. The code is open; the answers are protected by the key.
* `node run.mjs` shows the plan; `node run.mjs --send` does one batch.
