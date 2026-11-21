# makefun-sokoban-solver-01-run-20261121

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/willdinata/makefun-sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/willdinata/makefun-sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A deterministic, push-optimal Sokoban solver for hallway-and-room levels. It splits the board into independent rooms and solves each with push-based A*, using canonical player reachability, reverse push distances, dead-square pruning, and minimum-cost box-to-goal matching. Optimal room solutions that allow an exit are preferred; an exit-blocked room is visited last. Inconsistent room decompositions use the same push search on the whole board.

## Run

Requires Node 22 with native `.ts` execution enabled. The entry uses plain JavaScript syntax and Node built-in modules; no installation is needed.

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=solutions node main.ts
```

The default directories are `/input` and `/output`. Each input `<id>/level.txt` produces `<id>/solution.txt`, with lowercase walks, uppercase pushes, and a trailing newline. Search budgets are deterministic expansion counts.

## Practice check

```sh
node dev-check.mjs
```

The checker independently replays each solution, compares push counts with the practice manifest, and checks byte-identical outputs from two runs. Its temporary output directories are created inside this repository and removed afterward.

---

<sub>Entered on [make.fun](https://make.fun/?ref=63p7zf8z&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards.</sub>
