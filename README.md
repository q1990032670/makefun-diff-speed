# makefun-diff, faster

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/q1990032670/makefun-diff-speed/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/q1990032670/makefun-diff-speed/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for makefun-diff 1.0.0: `solve.js` returns exactly the same patch as the reference on every input, at roughly 3× less CPU time on the practice set (median `run()` CPU ~0.11 s per case vs ~0.33 s for the reference). `main.ts` is the harness driver: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

## How it is faster

The reference runs Myers's greedy search with a linked list of path components allocated for every (d, k) step. This module keeps the exact same search — same diagonals, same deletion-on-tie rule, same no-edge-pruning, same snake — but stores only one small integer per (d, k): the furthest old-line count reached on that diagonal, snapshotted per d in a `Uint16Array` so the edit script can be walked back out with the same predecessor rule. Lines stay plain strings (slices of the input text, so no line text is copied), and a 32-bit FNV-1a hash of each line filters the ~7M snake checks per case down to one integer compare each; the string compare still decides equality, so the hash can never change an answer.

Verified locally with the kit: `grade-local` on the practice set gives `passed: 1, cases_passed: 4/4`, with the two executions reproducing byte for byte. The solver was also checked against the reference on 4,014 random small cases and 24 generated large cases (empty texts, bare final lines, CRLF, swapped and moved lines, repeated lines) with no differences.

## Layout

- `solve.js` — the fast diff: `run({ old, new })` returns the makefun-diff/1 patch string.
- `main.ts` — the program the harness runs (`node /bot/main.ts`).
- `package.json` — `{"type": "module"}`.

## License

MIT — see `LICENSE`.
