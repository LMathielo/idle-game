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
| Repeat "clock forward 8 h → open → clock forward 8 h → open…" | **Known limit, not closed on the device.** Each jump is a fresh, legitimate-looking 8 h (the cap is per call), so a player can farm 8 h per jump. Nothing on the phone can tell this from real waiting. **Closed by server-owned time**: once the server stamps `now`, the client clock is ignored. Every jump is logged (`RESUME` with `requestedMs`, `CLOCK_ANOMALY` when capped), so a server can flag it retroactively. |

## XP curves

```
xpToNext(L) = round(base × L × √L × multiplier(L))      (L^1.5, computed without Math.pow)
multiplier(L) = product of growth(l) for every level l < L
growth: levels 1–19 → 1.00 · 20–39 → 1.05 · 40–99 → 1.07 · 100+ → 1.18
```

`L^1.5` is computed as `L × Math.sqrt(L)`: multiplication and `sqrt` are exactly rounded in IEEE 754, so Hermes (phone) and V8 (a Node server) get identical bits, while `Math.pow` may differ between runtimes. A guard test bans `Math.pow`, `**`, `exp`, `log` and trig functions in `src/engine`. Hero `base = 1500`, skills `base = 500` (same shape, a third of the hero numbers). No level cap. Values above `Number.MAX_SAFE_INTEGER` clamp to it; that only happens far beyond level 150 (level 150 needs ~1.7 × 10^12). Big numbers are a backlog item. Data: `src/engine/config/xpCurve.ts`.

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

## Attributes & derived stats

The hero has 4 attributes, stored as plain integers in `character.attributes`: `strength`, `dexterity`, `endurance`, `intelligence`. A new hero starts at 10 in each. They will be raised by Training (gold + time, M3).

| Attribute | Effect today |
| --- | --- |
| Strength | +1 flat damage per point (min and max) |
| Endurance | +1 flat defense per point, +1 HP regen per minute |
| Dexterity | −1 s dungeon run time per point (minimum run 60 s) |
| Intelligence | none yet |

**Derived stats are computed, never stored.** `getDerivedStats(state)` (`src/engine/stats.ts`) returns `damage {min, max}`, `defense`, `maxHp` and `maxMana`, each with a `breakdown` whose parts add up to the final number (the Hero tab shows it on tap). Coefficients: `src/engine/config/stats.ts`.

```
damage  = round(weapon.damage  × (1 + Σ percent)) + STR × 1        (each of min and max)
defense = round(Σ equipped armor × (1 + Σ percent)) + END × 1
maxHp   = 50 + 10 × (level − 1)
maxMana = 20 + 5 × (level − 1)
```

- **Attribute points are flat FINAL bonuses**: percent bonuses scale only the base (gear) part, never the STR/END part (owner decision; tested).
- **Unarmed** (no weapon, or a weapon `defId` the catalog does not know): 1–2.
- **Gear bonuses (planned, M4).** Base item stats come from the catalog. Rolled affixes on dropped items will be stored on the item instance. Flat affixes ("+3 damage", "+2 armor") will add to the **base** part, before percent bonuses. Percent affixes ("+5% armor") join the percent list. Attribute points always stay last, unscaled. Confirm this order when loot ships.
- **Percent bonuses** are integer basis points (`1000` = +10%) collected by `percentBonuses(state)`. The list is empty today; future upgrades plug in there. They are summed and rounded once, so the breakdown has a single `percent` line whose `bonuses` field lists every source and its bp. Rounding is integer half-up, `floor((base × (10000 + Σbp) + 5000) / 10000)`, with the factor floored at 0. No `Math.pow`.
- New hero: damage 12–14 (2–4 Rusty Gladius + 10 STR), defense 13 (2 Linen Tunic + 1 Worn Sandals + 10 END), HP 50, mana 20.
- **Current HP is stored (save v4), max HP is not.** `character.hp` is clamped to the derived max; a level-up raises the max, not the current value. See "Dungeon & combat" for regen. There is no current mana yet.

### Item catalog

Base item combat stats (`damage`, `armor`) live only in the catalog `ITEMS` (`src/engine/config/items.ts`), keyed by definition id. Every stored item carries `defId`; stats are looked up through it and never copied onto the instance, so a balance change needs no save migration. Inventory stacks merge by `defId`. Rolled affixes (M4) are the exception: they differ per drop, so they will live on the instance. A stored item with extra stat fields is ignored (tested).

| defId | Slot | Stats |
| --- | --- | --- |
| `rusty_gladius` | weapon | damage 2–4 |
| `linen_tunic` | armor | armor 2 |
| `worn_sandals` | boots | armor 1 |

## Stamina

`state.stamina = { current, max, progressMs }`. A new hero starts at 100/100. `max` is stored per player (a future upgrade can raise it); it is 100 for everyone today. Data: `src/engine/config/stamina.ts`; rules: `src/engine/stamina.ts`.

- **Regen: +1 every 5 minutes** (`regenIntervalMs = 300000`), never above max. The remainder stays in `progressMs`, so no partial time is lost between resumes (many small resumes = one big one; tested).
- **At max, `progressMs` stays 0.** Time spent full is not banked; the 5-minute timer starts when stamina is spent.
- Regen runs inside `simulate()` on the **accepted** elapsed time, so it follows the same time rules as woodcutting: clock moved back (rule b) or jitter (rule c) → no regen, paused until real time catches up; invalid time (rule e) → no-op.
- **Not limited by the 8 h offline cap (rule d).** Stamina uses `requestedMs`, not the capped `grantedMs`. Why: the cap exists so idle *rewards* cannot pile up without limit. Stamina already has its own hard limit (max 100 = 8h20 from empty), so a long absence simply fills the bar, which is what a returning player expects. Capping it too would only matter for the 20 minutes between 8h and 8h20, and would make the bar look broken after a long break. Clock-forward abuse gains at most one full bar per jump, the same order as the activity cap, and is closed by server-owned time like the rest (see exploit table).
- `spendStamina(state, amount)` returns `{ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' | 'INVALID_AMOUNT' } }` instead of mutating. Callers simulate to `now` first (`applyCommand` does), so regen up to that moment counts.
- **Spent only to skip a dungeon run** (see "Dungeon & combat"). The old planned costs (run 10, boss 25) are gone. Waiting is always free.
- `staminaView(state)` gives the UI `nextInMs` (to the next point) and `fullInMs` (to a full bar).

## Dungeon & combat

Data: `src/engine/config/dungeons.ts` (`DUNGEON_RUN` skip rule, `COMBAT`, `ENEMIES`, `DUNGEONS` with each dungeon's run timing, unlock rule and rewards, `DANGER` thresholds). Rules: `src/engine/dungeon.ts` (runs, per-dungeon counters, unlocks), `src/engine/combat.ts` (fight), `src/engine/hp.ts` (HP regen), `src/engine/danger.ts` (danger hint).

### Tiers (2026-10-26, engine 1.4.0)

Five dungeons, one enemy each. All of it is data (`DUNGEONS`, `ENEMIES`); no dungeon has its own code.

| # | id | Name | Enemy (HP · dmg · def) | Base run (DEX 10) | Unlock | Win: XP · gold | Loot |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `rat_cellar` | Rat Cellar | Rat 30 · 3–5 · 2 | 5:00 (4:50) | — | 25 · 2–5 | Rat Skin 50% |
| 2 | `bat_cave` | Bat Cave | Bat 60 · 6–9 · 6 | 7:00 (6:50) | 10 wins in Rat Cellar | 60 · 6–12 | Bat Wing 40% |
| 3 | `wolf_den` | Wolf Den | Wolf 110 · 10–14 · 12 | 9:00 (8:50) | 15 wins in Bat Cave | 140 · 15–30 | Wolf Pelt 30% |
| 4 | `forgotten_crypt` | Forgotten Crypt | Skeleton 180 · 15–20 · 20 | 11:00 (10:50) | 25 wins in Wolf Den | 300 · 35–60 | Old Bone 25% |
| 5 | `troll_bridge` | Troll Bridge | Troll 300 · 22–30 · 30 | 13:00 (12:50) | 40 wins in Crypt | 650 · 80–130 | Troll Hide 20% |

Every tier uses the same run rule (−1 s per DEX, minimum 1:00), skip rule, combat, regen and auto-repeat. Loot items are stackable commons in the item catalog.

Reach (1000 fights per cell with the real combat code, full HP; 2026-10-26): a hero with base attributes (STR/END 10) beats Bat Cave from Lv 1 and Wolf Den from about Lv 6–7. The Crypt needs about STR/END 20 at Lv 10 (98% wins) and the Troll about STR/END 30 at Lv 20; at STR/END 10 both are 0%. So tiers 4–5 wait for Training (M3), as intended.

### Unlocks

```
DungeonDef.unlock = { dungeonId, wins } | null      (null = open from the start)
unlocked  ⇔  lifetime WINS in unlock.dungeonId ≥ unlock.wins
```

- Only wins count, never losses or runs. Win counters never go down, so an unlock is permanent.
- Counters: `state.dungeon.byDungeon[id] = {runs, wins, losses}` (an entry appears with the first run; missing = 0). `state.dungeon.totals` stays as the sum over all dungeons, because `totals.runs + 1` numbers the run in progress for the skip binding and must stay unique across dungeons.
- `START_ACTIVITY {kind:'dungeon', dungeonId}` on a locked dungeon fails with **`DUNGEON_LOCKED`** and changes nothing.
- When a win (or the debug grant) crosses a requirement, the engine emits **`DUNGEON_UNLOCKED {dungeonId}`** once and adds the id to `SimulationSummary.dungeonsUnlocked`. The client collects the events into `snapshot.unlockedDungeons` for the banner (cleared by `dismissUnlocks()`); the away summary lists offline unlocks.
- UI selector: `dungeonUnlockView(state, id) → {unlocked, requirement: {dungeonId, wins} | null, progress}` (progress capped at the requirement). A future condition (e.g. hero level) becomes another optional field of the rule, checked in `isDungeonUnlocked`.

### Danger hint

`dangerHint(stats, dungeonId)` (pure, no RNG, never simulates a fight) estimates the HP one fight costs from full HP with **average rolls**:

```
heroAvg  = mean dealt per hero strike over every roll (after enemy defense)
enemyAvg = mean dealt per enemy strike (after hero defense)
heroHits = ceil(enemy HP / heroAvg);  expected loss = (heroHits − 1) × enemyAvg   (the hero strikes first)
percent  = loss / max HP:  < 40% Easy · < 100% Risky · otherwise Deadly (also Deadly when heroHits > 50 rounds)
```

Thresholds live in `DANGER`. A fresh hero sees Easy, Risky, Deadly, Deadly, Deadly.

### One activity at a time

`state.activity` is either a gathering skill (`{kind: 'woodcutting'}`) or `{kind: 'dungeon', dungeonId}`. `START_ACTIVITY` with the other kind stops the running one first. **Stopping a dungeon (STOP_ACTIVITY, or starting woodcutting) cancels the run in progress: it is lost, with no fight and no rewards** (event `DUNGEON_RUN_CANCELLED`). Runs that already finished before the command are kept, because every command first simulates to `now`. The UI asks before either action.

### Runs (auto-repeat)

```
runMs = max(minMs, baseMs − perDexterityMs × DEX)  per dungeon (DungeonDef.run): runMsFor(dungeonId, attributes)
Rat Cellar: max(60 000, 300 000 − 1 000 × DEX)      DEX 10 → 290 s (4:50)
```

`activity.progressMs` is the time into the current run. While the dungeon activity is active, runs follow each other back-to-back, live and offline: when a run's time is up its fight resolves, and the next run starts **at once, whatever the HP**. Dungeon time goes through the same `simulate()` and the same time rules as woodcutting: backward clock = pause, invalid time = no-op, and the **8 h offline cap limits the number of runs** (8 h / 4:50 = 99 runs).

### Skip

`SKIP_DUNGEON_RUN` costs `ceil(remainingMs / 60 000)` stamina (1 per started minute left, at least 1: 5:00 → 5, 2:10 → 3, 0:30 → 1) and resolves the current run's fight right away at the current HP; the next run starts from 0. Not enough stamina → typed error `NOT_ENOUGH_STAMINA`, nothing changes (the UI greys the button). No dungeon running → `NO_DUNGEON_RUN`.

The command is bound to what the player saw: `{ run, maxCost }`, where `run` is the run number on screen (`DungeonRunView.run` = lifetime runs + 1) and `maxCost` the cost on the button. If that run already finished by the time the command is applied (time passes between the tap and `now`, and the client simulates first), or the real cost is higher than `maxCost`, the skip fails with **`RUN_CHANGED`** and nothing is spent. So a skip never charges more than shown and never resolves the next run instead (the finished run was resolved for free by waiting). The UI stays quiet on `RUN_CHANGED`: the screen already shows the new run and cost. At 0 HP the skip stays enabled and the UI warns "Certain loss — 0 HP". It is a logged command, replayed like any other. Waiting is always free.

### Current HP and regen

```
regen per minute = 5 + 1 × END                     END 10 → 15/min (1 HP every 4 s)
```

- Flat and continuous: during runs, while woodcutting, idle and offline.
- Remainder kept like stamina, in `character.hpRegenProgress`, in "HP·ms per minute" units: each ms adds the rate, 60 000 units = 1 HP. Integer math, exact across resumes (many 1 s ticks = one big resume, tested) and when END changes. At max HP the remainder is 0.
- Uses the sanitized time **before** the 8 h cap (`requestedMs`), like stamina: max HP already bounds it. Backward clock or jitter → no regen; invalid time → no-op.
- A fight that starts at 0 HP is an immediate loss with no rolls.

### Offline interleaving

`advanceDungeon()` walks the granted (capped) time run by run, in time order:

1. regen HP over the time left in the current run;
2. at the run's end, resolve the fight with the HP at that moment; the hero keeps the HP left (0 after a loss);
3. start the next run at once and repeat until the granted time is used up (the leftover goes into `progressMs`);
4. then regen over the rest of the uncapped time (the part of a long absence beyond the cap only counts for regen).

Live 1 s ticks and one big resume give the same state, byte for byte (tested), because both split time only at run ends.

### Fight

```
turns alternate, the hero strikes first; each strike rolls a whole number in [min, max] (seeded RNG)
dealt = max(1, round(roll × K / (defense + K)))       K = 50; 13 defense blocks ~21%
```

- Rounding is integer half-up: `floor((2 × roll × K + (def + K)) / (2 × (def + K)))`. No `Math.pow`; the engine guard test bans it.
- Hero damage and defense come from `getDerivedStats`. No hit chance or crit yet.
- The fight ends when either side reaches 0 HP, or after **50 rounds, which is a loss**. Every loss leaves the hero at 0 HP (also a round-cap loss).
- The engine writes why it ended into the record: `endReason` = `enemy_defeated` | `hero_defeated` | `round_cap` | `no_hp`. The UI labels it and never recomputes it.
- **Win:** the tier's hero XP (through `addXp`, so multi-level-ups carry over), gold (rolled in the tier's range), then each drop (rolled). Rolls happen in that order after the fight. A full inventory loses the item, like woodcutting drops. **Loss:** nothing.
- Example, Rat Cellar: one Rat (HP 30, damage 3–5, defense 2). A new hero (12–14 damage, 13 defense, 50 HP) kills it in 3 hits and takes 4–8 damage (two rat strikes of 2–4 after defense).

### Stored log policy

The engine produces the fight log (`{round, actor, roll, dealt, targetHpAfter}` per strike) and the UI only replays it. To keep saves small, **only the last fight is stored** (`state.dungeon.lastFight`, at most 100 entries), plus lifetime counters: `state.dungeon.totals = {runs, wins, losses}` over all dungeons and `state.dungeon.byDungeon[id]` per dungeon. No per-run log is kept; an offline catch-up of 99 runs keeps only the 99th. The "While you were away" summary carries the totals for the period (runs, wins, losses, hero XP, gold, loot).

## Storage: SQLite as a document store

**Decision.** The owner prefers a MongoDB-style model because player attributes will keep growing. No MongoDB/Realm option runs in Expo Go (Realm and Atlas Device Sync are end-of-life), so we use **expo-sqlite** (bundled in Expo Go) as a document store:

- Aggregates are JSON documents in `documents(collection, id, doc, doc_version, updated_at)`. Adding a field to `GameState` needs no SQL schema change. `json_extract` queries fields directly (`SQLiteGameRepository.getStateField('$.character.name')`).
- SQLite gives atomic transactions, so a log row and the state it produced are always written together.
- The `('game_state','main')` document has the same shape as a future server MongoDB `players` document, so sync maps 1:1.

The repository talks to a small `SqlDatabase` interface. The app passes `expo-sqlite` (async API, `withExclusiveTransactionAsync`); tests pass Node's built-in SQLite, so the real SQL is under test.

### Save versions

`GameState.saveVersion` plus ordered pure migrations in `src/engine/migrations.ts` (`MIGRATIONS[n]` upgrades v`n` to v`n+1`). A save newer than the app is refused instead of being overwritten. To change the shape: bump `CURRENT_SAVE_VERSION`, add the migration and a frozen fixture of the old version under `tests/fixtures/`.

Current version: **5**.

- v1 → v2 adds `flags.debugUsed` (set to `false` for old saves).
- v2 → v3 (2026-10-26): attributes become strength→strength, dexterity→dexterity, constitution→endurance, intelligence→intelligence, each set to **max(old value, 10)** so old heroes match the new-hero baseline (owner decision); agility and charisma are dropped; `character.hp`/`maxHp` are dropped; `stamina` is added full (100/100); every equipped and inventory item gets a `defId` (stackables: their id; starting gear: `start-<defId>`). Literals in the migration are frozen on purpose, so later config changes cannot change what it produces.

- v3 → v4 (2026-10-26): `character.hp` = max HP at the hero's level (`50 + 10 × (level − 1)`, frozen literals), `character.hpRegenProgress = 0`, `dungeon = {lastFight: null, totals: 0/0/0}`. The activity is kept (v3 only had woodcutting, so no save is in a dungeon).
- v4 → v5 (2026-10-26): dungeon tiers. The dungeon id `rat_cellar_1` becomes `rat_cellar` (running activity and last fight). Every v4 run was a Rat Cellar run, so `dungeon.byDungeon = {rat_cellar: totals}` (empty when there were no runs) and the old wins count toward the Bat Cave unlock. `totals` is kept. Frozen literals again.

Frozen fixtures that must keep loading: `tests/fixtures/save-v1.json` and `tests/fixtures/save-v2.json` (made with the 1.1.0 engine: hero Lv4, woodcutting Lv8, 3785 logs, banked progress), `tests/fixtures/save-v3.json` (made with the 1.2.0 engine before the dungeon: hero Lv5, DEX 15, END 12, woodcutting running, 68 stamina), and `tests/fixtures/save-v4.json` + `log-v4.json` (made with the 1.3.0 engine before the tiers: hero Lv3, DEX 13, END 12, Rat Cellar running mid-run, 19 runs / 18 wins / 1 loss, plus the action log that produced it, all rows at engine 1.3.0).

**Rules version.** `ENGINE_VERSION` (`src/engine/version.ts`) is written on every log row. Bump it whenever rules change outcomes. `tests/golden.test.ts` pins the final state hash of a fixed seed and script, so an unintended rules change fails CI. 1.1.0: XP curve uses `L × √L`, and `flags.debugUsed` was added. 1.2.0 (2026-10-26): save v3, stamina regen in `simulate()`, stamina/attribute debug commands; woodcutting outcomes unchanged (same actions, levels and drops in the golden script). The golden script now also spends stamina and adds STR, so the hash changed. 1.3.0 (2026-10-26): save v4, HP regen, dungeon runs and combat. Woodcutting outcomes unchanged (same actions, levels, nests and stamina in the golden script); the script gained a dungeon segment (start, skip, HP debug, 3 h of runs, woodcutting cancelling a run), so the hash changed. 1.4.0 (2026-10-26): save v5, dungeon tiers 1–5, per-dungeon counters, unlocks, `DEBUG_ADD_DUNGEON_WINS`, MIGRATE anchors. Rat Cellar outcomes unchanged (a golden test pins the 1.3.0 part of the script: same runs, gold, HP, stamina, level); the hash changed because of `byDungeon` and the id rename. The script gained a tier segment (debug wins, Bat Cave runs).

**Known limit, still open:**
- The SQL schema has only `schema_version = 1` in `meta` and `CREATE TABLE IF NOT EXISTS`. Add ordered SQL schema migrations keyed on `meta.schema_version` before the first table change.

## Action log & sync

`action_log(seq, command_id UNIQUE, type, payload JSON, client_time, engine_version, state_hash, synced)` is append-only. Every stored state change is one transaction: log row(s) + state document. Never one without the other.

| type | When | Payload |
| --- | --- | --- |
| `NEW_GAME` | First launch, Reset save | `{ seed }` (`+ reason, debugUsed: true` after Reset save) |
| `START_ACTIVITY`, `STOP_ACTIVITY`, `SKIP_DUNGEON_RUN`, `DEBUG_GRANT_HERO_XP`, `DEBUG_SPEND_STAMINA`, `DEBUG_REFILL_STAMINA`, `DEBUG_ADD_ATTRIBUTE`, `DEBUG_SET_HERO_HP`, `DEBUG_FINISH_DUNGEON_RUN`, `DEBUG_ADD_DUNGEON_WINS` | Player/debug commands; `command_id` = command id | the command |
| `MIGRATE` | `load()` found a save that needed a migration, or `meta.engine_version` ≠ `ENGINE_VERSION`. Written in the same transaction as the migrated state and the new `engine_version` | `{ fromSave, toSave, fromEngine, toEngine, snapshot }` (snapshot = full post-migration GameState) |
| `RESUME` | App start, back from background, debug clock change. Skipped when no time passed and there was no anomaly | `{ summary }` |
| `SIMULATE` | Live-play checkpoint: every 30 s while an activity runs (every 10 min when idle), before any other row, on background | `{ checkpoint: true }` or `{ summary }` |
| `CLOCK_ANOMALY` | Any anomaly from a resume, or the first one seen while ticking | the anomaly event |
| `DEBUG_CLOCK_OFFSET`, `DEBUG_RESET_SAVE` | Debug panel | `{ deltaMs, offsetMs }` / `{}` |

`state_hash` is the hash of the state **after** the row. Replaying rows in order with `replayLog` (engine) reproduces every hash: commands go through `applyCommand(state, payload, client_time)`, `RESUME`/`SIMULATE` through `simulate(state, client_time)`, `CLOCK_ANOMALY` changes nothing, and `DEBUG_CLOCK_OFFSET` / `DEBUG_RESET_SAVE` only set `flags.debugUsed`. Replay accepts `DEBUG_*` rows even in a build with `DEV_TOOLS_ENABLED = false`, so a log never becomes unreplayable. Tested on both the memory and SQL repositories.

### Replay anchors (engine-version spans)

**Rule: a replay is only valid within one engine-version span; MIGRATE anchors stitch the spans together.** Rows written by engine 1.3.0 mean 1.3.0 rules (and 1.3.0 ids such as `rat_cellar_1`); running them on 1.4.0 rules would diverge or fail. So:

- On `load()`, when the stored save needed a migration or `meta.engine_version` differs from `ENGINE_VERSION`, the client writes a **`MIGRATE`** row whose payload carries the full post-migration state (`snapshot`) and whose `state_hash` is that snapshot's hash, in the same transaction as the migrated document and the new `engine_version`. If that commit fails, nothing changes and the next load tries again. A fresh install writes `NEW_GAME` instead; a load with the same engine and save version writes nothing.
- `replayStep` on a `MIGRATE` row resets the state to the snapshot (checking it against the row's `stateHash` when given, then `loadSave` in case a later save version reads it) and continues with the current engine.
- `replayLogReport(entries)` splits the log into spans that start at `NEW_GAME` or `MIGRATE`. A span whose rows all carry the current `engineVersion` (a missing value counts as current) is re-simulated and every row's `stateHash` is checked; any other span is **not re-simulated** and is counted as `verifiedUpToAnchor`. Rows from another engine after the last anchor are an error. `ReplayEntry` carries `engineVersion` and `stateHash`.
- A future server keeps old engine builds (or trusts its own earlier verification) for the old spans; the anchors are where it switches.

**Live play.** While the app is open, `tick()` runs every second through the same `simulate()`. Ticks stay in memory and are checkpointed every 30 s and when the app goes to the background, so the log does not grow by one row per second. If the app is killed in between, nothing is lost: the next launch re-simulates from the last stored state to now, which gives the same result (determinism).

**Retention (planned, not implemented in M1).** The log grows by about 2 rows per 30 s of active play plus a few rows per session, which is a few MB per year of heavy play. Once sync exists: delete rows that are `synced = 1` and older than 30 days, never unsynced rows and never the latest `NEW_GAME`. A server that holds the full history can still replay. Until sync ships, nothing is deleted.

**Sync readiness.** `SyncTransport.pushLog(rows) → acked seqs`, `LocalGameClient.getUnsyncedLog()` and `syncOnce(transport)` exist. M1 ships `NoopSyncTransport`; nothing leaves the device.

## "While you were away"

Shown after app start, a return from background or a debug clock change when **at least 60 s of real time passed and there was at least one gathering action or dungeon run** (`AWAY_SUMMARY_MIN_MS` in `config/time.ts`), or when there was **any clock anomaly**. A quick app switch is still simulated and logged, but opens no modal. It lists dungeon runs (won/lost), dungeons unlocked, hero XP, gold and loot next to gathering results.

The summary is an RN `<Modal>`. On iOS it presents from the view controller that owns it, and the root controller cannot present while a full-screen village modal is up, so each village modal route renders its own `<AwayModal />` and the root one hides on those routes (`RootAwayModal` in `src/app/_layout.tsx`).

## Debug tools

`DEV_TOOLS_ENABLED` in `src/engine/config/dev.ts` shows a Debug panel on the Hero tab. It stays on for the POC. Any `DEBUG_*` action sets `state.flags.debugUsed = true` forever (it survives later play, Reset save and replay), so a future server can tell debugged saves apart. The clock buttons change a persisted **offset** on the client clock (`SystemClock.offsetMs`), then resume, so the engine sees exactly what a player who changed the phone clock would produce. "+10k hero XP" is a real logged command (`DEBUG_GRANT_HERO_XP`), and so are "Spend 10 stamina" (`DEBUG_SPEND_STAMINA`, refused with `NOT_ENOUGH_STAMINA` below 10), "Refill stamina" (`DEBUG_REFILL_STAMINA`), "+1 STR / DEX / END / INT" (`DEBUG_ADD_ATTRIBUTE`, 1–1000 per command, an attribute can reach at most 1,000,000), "Hero HP → 1" (`DEBUG_SET_HERO_HP`, 0..max, clears the regen remainder) and "Finish run now (free)" (`DEBUG_FINISH_DUNGEON_RUN`, resolves the current run's fight like a skip without stamina; refused with `NO_DUNGEON_RUN` when no dungeon runs). In a dungeon's detail view, "+10 wins (debug)" (`DEBUG_ADD_DUNGEON_WINS`, 1–1000 per command, unlocked dungeons only) adds wins and runs to that dungeon's counters with no fight and no rewards, so unlocks can be tested on the phone. "Reset save" logs `DEBUG_RESET_SAVE` + `NEW_GAME` and clears the offset; it never deletes log rows. None of them change engine rules.
