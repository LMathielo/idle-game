# Engine, time & storage

How the game rules, time, saves and the action log fit together. Read this before touching `src/engine` or `src/client`.

## Layers

```
 UI (src/app, src/components)
   │  useGameState() / useGameClient()        ← React hooks (src/client/GameProvider.tsx)
   ▼
 GameClient (src/client/LocalGameClient.ts)   ← load / dispatch / resume / tick / persist / debug
   │                    │
   │ pure calls         │ one transaction per state change
   ▼                    ▼
 Engine (src/engine)   GameRepository (SQLite in the app, in-memory in tests)
 applyCommand            ├─ documents   ('game_state','main') = whole GameState as JSON
 simulate                ├─ action_log  append-only outbox, one row per command/system event
 newGame, hash, rng      └─ meta        schema_version, device_id, engine_version, debug clock offset
                                   │
                                   ▼
                         SyncTransport.pushLog(rows) → acked seqs     (NoopSyncTransport in M1)
                                   │
                                   ▼
                         future server: replays the log with the same engine and checks state_hash
```

The engine imports nothing from React, React Native, Expo or storage, never reads the clock and never calls `Math.random`. A test (`tests/engineGuard.test.ts`) enforces this.

## Seeded randomness, in plain words

The game needs dice rolls (a Bird Nest drops on 1 in 200 chops). Instead of asking the phone for a random number, the engine keeps a **seed** (one number) inside the save. Each roll turns the seed into a random-looking number and stores the next seed. The same seed always produces the same rolls in the same order (algorithm: mulberry32).

Why this matters:

- **Offline play.** Eight hours away runs the exact same per-action code as live play. The result does not depend on when or how often the app was opened: 100 resumes of 1 s give the same save, byte for byte, as one resume of 100 s (tested).
- **Server validation later.** The server receives the action log, replays it from the `NEW_GAME` seed with the same engine and compares each row's `state_hash`. A tampered save or a modified client shows up as a hash mismatch.
- **Reproducible bugs.** A player's log replayed on a laptop gives exactly their state at every step.

The hash is FNV-1a 32-bit over canonical JSON (keys sorted). It detects divergence; it is not a security signature.

## Time rules

`simulate(state, now)` is the only place where time turns into rewards. `now` is passed in (epoch ms). Each `applyCommand` first simulates up to `now`, so rewards are never lost or counted twice.

| Rule | Behavior |
| --- | --- |
| a | `elapsed = now − time.lastSimulatedAt` |
| b | Clock moved back (`now < highestSeenAt − 60 s`): grant 0, never move `lastSimulatedAt`/`highestSeenAt` back, emit `CLOCK_ANOMALY {kind:'backward', deltaMs}`. Progress stays paused until real time passes `highestSeenAt` again. No other penalty. |
| c | Backward jitter within 60 s: 0 elapsed, no anomaly. |
| d | `elapsed > offline.capMs` (8 h): grant exactly the cap, emit `CLOCK_ANOMALY {kind:'forward_capped', requestedMs, grantedMs}`, set `lastSimulatedAt = now`. The excess is forfeited, never banked. |
| e | `now` is NaN/Infinity/not a number: no-op plus an `ERROR` event. |
| f | `highestSeenAt = max(highestSeenAt, now)` whenever `now` is accepted. |

Activity progress: `progressMs += granted × efficiency`; actions run one at a time while `progressMs ≥ interval` (the interval is recomputed after each skill level-up); the remainder is kept, so no partial time is lost between resumes. 8 h at the fastest interval (1.2 s) is 24 000 iterations, well under a second.

The cap (`offline.capMs`) and `offline.efficiency` live in each player's save, so a future upgrade can raise them.

### Exploits these rules close

| Exploit | Result |
| --- | --- |
| Set the clock forward a week, open the app | Granted 8 h only; the rest is forfeited, not banked. |
| Clock forward → collect → clock back → collect again | The second collect grants 0 and pauses progress until real time catches up (rule b). Tested. |
| Clock back to "re-earn" the same hours | `highestSeenAt` never moves back; time before it is never paid twice. |
| Open the app many times in a row | Same `now` twice grants nothing the second time. Tested. |
| Kill the app mid-session | The last stored state is re-simulated on next launch; the engine is deterministic, so the result equals uninterrupted play. Tested. |
| Re-send the same command | `command_id` is UNIQUE; a duplicate is ignored and not re-applied. Tested. |
| Garbage time values | Rule e: no-op. |

## XP curves

```
xpToNext(L) = round(base × L^1.5 × multiplier(L))
multiplier(L) = product of growth(l) for every level l < L
growth: levels 1–19 → 1.00 · 20–39 → 1.05 · 40–99 → 1.07 · 100+ → 1.18
```

Hero `base = 1500`, skills `base = 500` (same shape, a third of the hero numbers). No level cap. Values above `Number.MAX_SAFE_INTEGER` clamp to it; that only happens far beyond level 150 (level 150 needs ~1.7 × 10^12). Big numbers are a backlog item. Data: `src/engine/config/xpCurve.ts`.

Owner's target: about 2 days of play to hero Lv20 and more than a year to Lv100. Hero XP comes from combat only (M4); gathering gives skill XP and items.

| Level | Hero xpToNext | Hero XP to reach this level | Skill xpToNext |
| ---: | ---: | ---: | ---: |
| 1 | 1,500 | 0 | 500 |
| 10 | 47,434 | 166,574 | 15,811 |
| 20 | 134,164 | 1,007,030 | 44,721 |
| 30 | 401,482 | 3,362,992 | 133,827 |
| 40 | 1,006,856 | 9,715,413 | 335,619 |
| 50 | 2,768,025 | 26,369,506 | 922,675 |
| 60 | 7,157,802 | 70,600,625 | 2,385,934 |
| 80 | 42,644,530 | 454,651,381 | 14,214,843 |
| 100 | 230,623,682 | 2,602,453,949 | 76,874,561 |
| 110 | 1,392,557,069 | 8,507,705,621 | 464,185,690 |
| 120 | 8,304,546,415 | 43,897,009,092 | 2,768,182,138 |

Woodcutting: 10 skill XP per action, interval 3000 ms at Lv1, −1% of base per level above 1, floor 1200 ms (reached at Lv61).

## Storage: SQLite as a document store

**Decision.** The owner prefers a MongoDB-style model because player attributes will keep growing. No MongoDB/Realm option runs in Expo Go (Realm and Atlas Device Sync are end-of-life), so we use **expo-sqlite** (bundled in Expo Go) as a document store:

- Aggregates are JSON documents in `documents(collection, id, doc, doc_version, updated_at)`. Adding a field to `GameState` needs no SQL schema change. `json_extract` queries fields directly (`SQLiteGameRepository.getStateField('$.character.name')`).
- SQLite gives atomic transactions, so a log row and the state it produced are always written together.
- The `('game_state','main')` document has the same shape as a future server MongoDB `players` document, so sync maps 1:1.

The repository talks to a small `SqlDatabase` interface. The app passes `expo-sqlite` (async API, `withExclusiveTransactionAsync`); tests pass Node's built-in SQLite, so the real SQL is under test.

### Save versions

`GameState.saveVersion` plus ordered pure migrations in `src/engine/migrations.ts` (`MIGRATIONS[n]` upgrades v`n` to v`n+1`). A save newer than the app is refused instead of being overwritten. To change the shape: bump `CURRENT_SAVE_VERSION`, add the migration and a fixture test of the old version.

## Action log & sync

`action_log(seq, command_id UNIQUE, type, payload JSON, client_time, engine_version, state_hash, synced)` is append-only. Every stored state change is one transaction: log row(s) + state document. Never one without the other.

| type | When | Payload |
| --- | --- | --- |
| `NEW_GAME` | First launch, Reset save | `{ seed }` |
| `START_ACTIVITY`, `STOP_ACTIVITY`, `DEBUG_GRANT_HERO_XP` | Player/debug commands; `command_id` = command id | the command |
| `RESUME` | App start, back from background, debug clock change | `{ summary }` |
| `SIMULATE` | Live-play checkpoint (every 30 s, before any other row, on background) | `{ checkpoint: true }` or `{ summary }` |
| `CLOCK_ANOMALY` | Any anomaly from a resume, or the first one seen while ticking | the anomaly event |
| `DEBUG_CLOCK_OFFSET`, `DEBUG_RESET_SAVE` | Debug panel | `{ deltaMs, offsetMs }` / `{}` |

`state_hash` is the hash of the state **after** the row. Replaying rows in order with `replayLog` (engine) reproduces every hash: commands go through `applyCommand(state, payload, client_time)`, `RESUME`/`SIMULATE` through `simulate(state, client_time)`, and informational rows change nothing. Tested on both the memory and SQL repositories.

**Live play.** While the app is open, `tick()` runs every second through the same `simulate()`. Ticks stay in memory and are checkpointed every 30 s and when the app goes to the background, so the log does not grow by one row per second. If the app is killed in between, nothing is lost: the next launch re-simulates from the last stored state to now, which gives the same result (determinism).

**Sync readiness.** `SyncTransport.pushLog(rows) → acked seqs`, `LocalGameClient.getUnsyncedLog()` and `syncOnce(transport)` exist. M1 ships `NoopSyncTransport`; nothing leaves the device.

## Debug tools

`DEV_TOOLS_ENABLED` in `src/engine/config/dev.ts` shows a Debug panel on the Hero tab. The clock buttons change a persisted **offset** on the client clock (`SystemClock.offsetMs`), then resume, so the engine sees exactly what a player who changed the phone clock would produce. "+10k hero XP" is a real logged command (`DEBUG_GRANT_HERO_XP`). "Reset save" logs `DEBUG_RESET_SAVE` + `NEW_GAME` and clears the offset; it never deletes log rows. None of them change engine rules.
