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

Activity progress: `progressMs += granted × efficiency`; logs are cut one at a time while `progressMs ≥ cut time`; the remainder is kept, so no partial time is lost between resumes. 8 h at the fastest cut time (10 s) is 2 880 iterations.

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
| Forge a `MIGRATE` row to reset the state to anything | Rejected by replay unless the anchor is chained to the row before it (`fromHash` = its `state_hash`, `fromEngine` = its engine), is a released engine upgrade whose save versions match `RELEASED_ENGINES`, matches its own `state_hash`, and, when the span before it was re-simulated, equals that replayed state after migration. Row labels are checked first: every `engineVersion` must be in `RELEASED_ENGINES` (no newer than this engine), and labels never go back along the log, so relabelling a current row as `9.9.9` (or an unknown or older version) to get its span skipped fails, and a skipped span holding any current-engine row (e.g. only row 0 relabelled) is refused. Tested for each case. **Known limit, applies to any log:** `engineVersion` is written by the client, so a forger can relabel a whole log as an older *released* engine, back to `NEW_GAME`, with consistent hashes; the device then skips those spans and only chain-checks the anchor. This gap closes only when a server re-simulates old spans with archived engine builds. |
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

Woodcutting XP per log depends on the tree (see "Woodcutting"); the old 3 s / 10 XP rule is gone since engine 1.6.0.

## Attributes & derived stats

The hero has 4 attributes, stored as plain integers in `character.attributes`: `strength`, `dexterity`, `endurance`, `intelligence`. A new hero starts at 10 in each. That stored value is the **base**; Training adds its level on top (see "Training"). **Every rule reads the effective value, base + trained** (`effectiveAttributes()`), and the formulas below use it.

| Attribute | Effect today |
| --- | --- |
| Strength | +1 flat damage per point (min and max) |
| Endurance | +1 flat defense per point, +1 HP regen per minute |
| Strength | also +1 woodcutting strength per point |
| Dexterity | −1 s dungeon run time per point (minimum run 60 s), −1 s per log cut (minimum 10 s) |
| Intelligence | none yet |

**Derived stats are computed, never stored.** `getDerivedStats(state)` (`src/engine/stats.ts`) returns `damage {min, max}`, `defense`, `maxHp` and `maxMana`, each with a `breakdown` whose parts add up to the final number (the Hero tab shows it on tap). Coefficients: `src/engine/config/stats.ts`.

```
damage  = round(weapon.damage  × (1 + Σ percent)) + STR × 1        (each of min and max; effective STR)
defense = round(Σ equipped armor × (1 + Σ percent)) + END × 1        (effective END)
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
| `wooden_axe` | axe (tool) | woodcutting strength +1 |
| `iron_axe` | axe (tool) | woodcutting strength +40 |
| `iron_sword` | weapon | damage 6–9 |
| `iron_helm` | helmet | armor 4 |
| `health_potion_t1` | — (stackable, usable) | heals 50 HP, capped at max |

Quality, description and prices are catalog-only too (save v8 dropped the per-instance `rarity`); see "Merchant & economy".

## Merchant & economy

Data: `src/engine/config/items.ts` (quality, description, `sellPrice`, `buyPrice`, `heal`) and `src/engine/config/merchant.ts` (charges, stock pool). Rules: `src/engine/merchant.ts` (stock, charges, buy, sell) and `src/engine/equipment.ts` (equip, unequip, use). The merchant is **not an activity**: every command below works while woodcutting, training or a dungeon runs, and never touches `state.activity`.

### Quality

| Quality | Color (`qualityColors` in `src/theme.ts`) | Meaning | Items |
| --- | --- | --- | --- |
| junk | gray `#b0a89c` | sell-only, no game use | Rat Skin, Bat Wing, Wolf Pelt, Old Bone, Troll Hide, Bread |
| common | white `#f5efe2` | has a game use (gear, crafting, consumables) | all logs, all gear, Health Potion |
| uncommon | green `#6fcf62` | rarity tier | Bird Nest |
| rare / epic / legendary | blue `#6fb0ff` / purple `#c79bf2` / dark yellow `#e0b030` | rarity tiers | none yet |

Every color passes 4.5:1 on `colors.sheet`, `colors.slot` and `colors.night`, the dark panels where names appear (`tests/theme.test.ts`).

### Prices (gold, integers)

| Item | Sell | Buy |
| --- | --- | --- |
| Rat Skin / Bat Wing / Wolf Pelt / Old Bone / Troll Hide | 2 / 5 / 12 / 25 / 60 | — |
| Oak / Birch / Maple / Yew / Ironwood Logs | 1 / 3 / 8 / 20 / 50 | — |
| Bird Nest | 30 | — |
| Health Potion (T1) | 5 | 12 |
| Iron Axe / Iron Sword / Iron Helm | 180 / 150 / 120 | 600 / 500 / 400 |
| Rusty Gladius / Linen Tunic / Worn Sandals / Wooden Axe / Bread | 3 / 2 / 1 / 1 / 1 | — |

Every buyable item sells for less than it costs (tested), so no buy→sell loop prints gold.

### State (save v8)

`state.merchant = { charges, chargeProgressMs, stock }` and `state.nextItemSerial`.

- `stock` has as many slots as the inventory had when it was rolled; each is `{ defId, quantity, unitPrice }` or `null` (empty or bought out). The price is fixed when the stock is rolled (from the catalog `buyPrice`).
- `rollStock(capacity)` fills the first slots with `MERCHANT.pool` in order: Health Potion ×10, Iron Axe ×1, Iron Sword ×1, Iron Helm ×1; the rest stay empty. No randomness yet; a seeded, rarity-tiered roll will replace it (it will take the RNG from state).
- Bought unique items get the instance id `<defId>#<n>` from `nextItemSerial`, which only goes up.

### Refresh charges

- **+1 every 2 h, max 5** (`chargeIntervalMs`, `maxCharges`). Charges beyond the max are lost; at max `chargeProgressMs` is 0 (time spent full is not banked), so spending from full starts a fresh 2 h timer.
- Regen runs in `simulate()` on the accepted, **uncapped** time, exactly like stamina: not limited by the 8 h offline cap (the max bounds it), no regen while the clock is behind (rules b, c), remainder kept across resumes.
- `merchantView(state)` gives the UI `charges`, `maxCharges`, `full`, `nextInMs` and the stock.

### Commands

| Command | Effect | Errors (nothing changes) |
| --- | --- | --- |
| `REFRESH_MERCHANT` | −1 charge, `stock = rollStock(inventory.capacity)` | `NO_REFRESH_CHARGES` |
| `BUY_ITEM {slot, defId, quantity, maxUnitPrice}` | gold −= unitPrice × quantity; stackables merge into their stack, unique items each take a slot; the listing's quantity drops, a bought-out slot becomes `null` | `UNKNOWN_SLOT`, `SLOT_EMPTY`, `STOCK_CHANGED` (another item is in the slot now), `INVALID_AMOUNT` (quantity outside 1..left), `PRICE_CHANGED` (price above `maxUnitPrice`), `NOT_ENOUGH_GOLD`, `INVENTORY_FULL` |
| `SELL_ITEM {itemId, quantity}` | gold += sellPrice × quantity; the stack shrinks or goes | `ITEM_EQUIPPED` (unequip first), `NOT_IN_INVENTORY`, `NOT_SELLABLE` (unknown to the catalog), `INVALID_AMOUNT` (outside 1..owned) |
| `EQUIP_ITEM {itemId}` | the item moves to its catalog slot; the item that was there takes its inventory place (no free slot needed, nothing lost) | `NOT_IN_INVENTORY`, `NOT_EQUIPPABLE` |
| `UNEQUIP_ITEM {slot}` | the item moves to the end of the inventory | `UNKNOWN_SLOT`, `SLOT_EMPTY`, `INVENTORY_FULL` |
| `USE_ITEM {itemId}` | potions: hp = min(max, hp + heal), −1 unit; at max the regen remainder is cleared | `NOT_IN_INVENTORY`, `NOT_USABLE`, `HP_FULL` |
| `DEBUG_ADD_MERCHANT_CHARGE` | +1 charge, sets `debugUsed` | `CHARGES_FULL`, `DEBUG_DISABLED` |

**Woodcutting stop rule:** after `EQUIP_ITEM` / `UNEQUIP_ITEM`, if woodcutting runs and WS is now below the tree's `reqWs`, the activity stops (`ACTIVITY_STOPPED`). Logs finished before the command are already banked (the command simulates to `now` first); the log in progress is dropped like any stop. WS cannot drop anywhere else (an equipped item can't be sold; STR only goes up), so `simulate()` needs no check.

`BUY_ITEM` carries `defId` as well as `maxUnitPrice`, so a tap on a stale screen never buys a different item than the one shown. Derived stats, woodcutting strength and run times read the equipment, so they follow every equip/unequip at once.

## Stamina

`state.stamina = { current, max, progressMs }`. A new hero starts at 100/100. `max` is stored per player (a future upgrade can raise it); it is 100 for everyone today. Data: `src/engine/config/stamina.ts`; rules: `src/engine/stamina.ts`.

- **Regen: +1 every 5 minutes** (`regenIntervalMs = 300000`), never above max. The remainder stays in `progressMs`, so no partial time is lost between resumes (many small resumes = one big one; tested).
- **At max, `progressMs` stays 0.** Time spent full is not banked; the 5-minute timer starts when stamina is spent.
- Regen runs inside `simulate()` on the **accepted** elapsed time, so it follows the same time rules as woodcutting: clock moved back (rule b) or jitter (rule c) → no regen, paused until real time catches up; invalid time (rule e) → no-op.
- **Not limited by the 8 h offline cap (rule d).** Stamina uses `requestedMs`, not the capped `grantedMs`. Why: the cap exists so idle *rewards* cannot pile up without limit. Stamina already has its own hard limit (max 100 = 8h20 from empty), so a long absence simply fills the bar, which is what a returning player expects. Capping it too would only matter for the 20 minutes between 8h and 8h20, and would make the bar look broken after a long break. Clock-forward abuse gains at most one full bar per jump, the same order as the activity cap, and is closed by server-owned time like the rest (see exploit table).
- `spendStamina(state, amount)` returns `{ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' | 'INVALID_AMOUNT' } }` instead of mutating. Callers simulate to `now` first (`applyCommand` does), so regen up to that moment counts.
- **Spent to skip a dungeon run, skip a log (see "Woodcutting") or speed up training** (see "Dungeon & combat"). The old planned costs (run 10, boss 25) are gone. Waiting is always free.
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
percent  = loss / max HP:  < 40% Easy · < 100% Tough · otherwise Deadly (also Deadly when heroHits > 50 rounds)
```

Thresholds live in `DANGER`. It measures the HP a fight costs, not the chance to lose: a fresh hero sees Bat Cave as Tough yet wins it every time. A fresh hero sees Easy, Tough, Deadly, Deadly, Deadly. The UI colors pass 4.5:1 on parchment.

### One activity at a time

`state.activity` is a gathering skill (`{kind: 'woodcutting'}`), `{kind: 'dungeon', dungeonId}` or `{kind: 'training', attribute}` (see "Training"). `START_ACTIVITY` with the other kind stops the running one first. **Stopping a dungeon (STOP_ACTIVITY, or starting woodcutting) cancels the run in progress: it is lost, with no fight and no rewards** (event `DUNGEON_RUN_CANCELLED`). Runs that already finished before the command are kept, because every command first simulates to `now`. The UI asks before either action.

### Runs (auto-repeat)

```
runMs = max(minMs, baseMs − perDexterityMs × DEX)  per dungeon (DungeonDef.run): runMsFor(dungeonId, effectiveAttributes(state))
Rat Cellar: max(60 000, 300 000 − 1 000 × DEX)      DEX 10 → 290 s (4:50)
```

`activity.progressMs` is the time into the current run. While the dungeon activity is active, runs follow each other back-to-back, live and offline: when a run's time is up its fight resolves, and the next run starts **at once, whatever the HP**. Dungeon time goes through the same `simulate()` and the same time rules as woodcutting: backward clock = pause, invalid time = no-op, and the **8 h offline cap limits the number of runs** (8 h / 4:50 = 99 runs).

### Skip

`SKIP_DUNGEON_RUN` costs `ceil(remainingMs / 60 000)` stamina (1 per started minute left, at least 1: 5:00 → 5, 2:10 → 3, 0:30 → 1) and resolves the current run's fight right away at the current HP; the next run starts from 0. Not enough stamina → typed error `NOT_ENOUGH_STAMINA`, nothing changes (the UI greys the button). No dungeon running → `NO_DUNGEON_RUN`.

The command is bound to what the player saw: `{ run, maxCost }`, where `run` is the run number on screen (`DungeonRunView.run` = lifetime runs + 1) and `maxCost` the cost on the button. If that run already finished by the time the command is applied (time passes between the tap and `now`, and the client simulates first), or the real cost is higher than `maxCost`, the skip fails with **`RUN_CHANGED`** and nothing is spent. So a skip never charges more than shown and never resolves the next run instead (the finished run was resolved for free by waiting). The UI stays quiet on `RUN_CHANGED`: the screen already shows the new run and cost. At 0 HP the skip stays enabled and the UI warns "Certain loss — 0 HP". It is a logged command, replayed like any other. Waiting is always free.

### Current HP and regen

```
regen per minute = 5 + 1 × END (effective)         END 10 → 15/min (1 HP every 4 s)
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

## Woodcutting

Data: `src/engine/config/woodcutting.ts` (`WOODCUTTING`, `TREES`). Rules: `src/engine/woodcutting.ts`. Owner-approved 2026-10-27, engine 1.6.0, save v7.

### Woodcutting strength (WS)

```
WS = 10 × woodcutting level + effective STR (base + trained) + axe bonus
```

`woodcuttingStrength(state)` returns the value and its breakdown (level part, STR part, axe part). The axe bonus is read from the item catalog (`woodcuttingStrength` on the axe's `defId`) of the item in the new **`axe`** equipment slot; no axe or an unknown `defId` gives 0. A new hero starts with the **Wooden Axe** (+1), so WS = 10 + 10 + 1 = **21**. At woodcutting level 5 a base hero has WS 61.

### Trees

| # | id | Name | Req. level | Req. WS | Base time / log | At DEX 10 | XP / log | Log item |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `oak` | Oak | 1 | 0 | 2:00 | 1:50 | 25 | `oak_logs` |
| 2 | `birch` | Birch | 5 | 100 | 5:00 | 4:50 | 119 | `birch_logs` |
| 3 | `maple` | Maple | 15 | 450 | 10:00 | 9:50 | 369 | `maple_logs` |
| 4 | `yew` | Yew | 28 | 905 | 18:00 | 17:50 | 853 | `yew_logs` |
| 5 | `ironwood` | Ironwood | 42 | 1395 | 30:00 | 29:50 | 1672 | `ironwood_logs` |

```
required WS    = max(0, 35 × reqLevel − 75)            (Oak: 0)
XP per log     = round(12.5 × base minutes × reqLevel^0.4)
cut time / log = max(10 s, base − 1 s × effective DEX)
```

Required WS and XP per log are **stored precomputed** in `TREES` (the engine bans `Math.pow`); `tests/woodcutting.test.ts` asserts both formulas against the stored values. Every log also rolls the **Bird Nest at 1/200** (seeded RNG), on every tree. Log items are stackable commons.

### Rules

- `START_ACTIVITY {kind:'woodcutting', treeId}`. A tree whose level **or** WS requirement isn't met fails with **`TREE_LOCKED`** (message says what is missing); an unknown or missing tree with `UNKNOWN_TREE`. The same tree again keeps the log in progress; another tree starts a new log from 0.
- Logs are cut back-to-back while active, live and offline, in the same `simulate()` with the same clock rules (8 h cap, backward = pause, invalid = no-op). Cut time depends on DEX only, which woodcutting never changes, so many small ticks equal one big resume (tested).
- One activity at a time: starting woodcutting stops training (XP kept) or cancels a dungeon run (lost; the UI asks first). Starting either of them stops woodcutting (logs kept).
- **Skip:** `SKIP_WOODCUT {log, maxCost}` costs `ceil(remaining min)` stamina (at least 1) and completes exactly the current log; the next log starts from 0. `log` is the log number on screen (`stats.totalActions + 1`, lifetime logs + 1). If that log already finished, or the real cost is higher than `maxCost`, it fails with **`LOG_CHANGED`** and nothing is spent (same guard as the dungeon skip). Other errors: `NOT_WOODCUTTING`, `NOT_ENOUGH_STAMINA`, `INVALID_AMOUNT`.
- Woodcutting level, XP and logs from before 1.6.0 are kept.
- Views: `woodcuttingView(state)` (level, XP, WS + breakdown, one `TreeView` per tree with ✓/✗ per requirement, the active tree, `focusTreeId` = active tree else the highest unlocked one, and the log in progress), `woodcutActivityView(state)` (tree, cut time, fraction, remaining, log number, skip cost).

## Training

Data: `src/engine/config/training.ts` (`TRAINING`). Rules: `src/engine/training.ts`; effective attributes: `src/engine/attributes.ts`. Owner-approved 2026-10-26, engine 1.5.0, save v6.

The player spends **gold** to unlock training tiers and **time** to raise STR, DEX, END and INT, one attribute at a time. It is the first gold sink, and the way to make dungeon tiers 4–5 beatable.

### Model

```
state.training = { tier: 0..10, attributes: { strength: { level, xp, progressMs }, dexterity: …, endurance: …, intelligence: … } }
effective attribute = character.attributes[k] (base: 10 + debug points) + training.attributes[k].level
```

- **Effective attributes feed every rule**: damage (STR), defense and HP regen (END), dungeon run time and skip cost (DEX). `getDerivedStats`, `hpRegenPerMinute`, `hpView` and `dangerHint` take the `training` slice (required in `StatsInput`, so it can't be left out), and `runMsFor` is always called with `effectiveAttributes(state)`. The stored attribute stays the base value.
- **Training XP: 1 XP per trained minute** at the base rate. `trained ms = granted ms × offline.efficiency × rateMultiplier`; `TRAINING.rateMultiplier` (1) is the hook for a later effect (e.g. INT) and does nothing today. It must stay a whole number: a fractional rate would need integer progress units, like HP regen. The remainder toward the next XP point is kept in `progressMs`, so no partial minute is lost between resumes.
- **XP to reach training level n: `5 + 10 × (n − 1)`**, integer math. Level 1 = 5 min, level 20 = 195 min, level 200 = 1,995 min. From level 0: +10 levels = 500 min, +20 levels = 2,000 min, all 200 levels = 200,000 min.
- **Tiers:** 10. Tier t allows training levels up to **20 × t** (200 in total). The tier is **global** (all four attributes). A new hero is at **tier 0: nothing is trainable**.
- **Price of tier t: `100 × t³` gold** (computed as `100 × t × t × t`, no `Math.pow`). Tiers are bought in order; the next one can be bought at any time, even before the current one is maxed.

| Tier | Price (gold) | Max level |
| ---: | ---: | ---: |
| 1 | 100 | 20 |
| 2 | 800 | 40 |
| 3 | 2,700 | 60 |
| 4 | 6,400 | 80 |
| 5 | 12,500 | 100 |
| 6 | 21,600 | 120 |
| 7 | 34,300 | 140 |
| 8 | 51,200 | 160 |
| 9 | 72,900 | 180 |
| 10 | 100,000 | 200 |

Tiers 1 and 2, per attribute (time at 1 XP per minute, while training that attribute):

| Lv | XP (min) | Total from 0 | Time | Lv | XP (min) | Total from 0 | Time |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5 | 5 | 0h 05m | 21 | 205 | 2,205 | 36h 45m |
| 2 | 15 | 20 | 0h 20m | 22 | 215 | 2,420 | 40h 20m |
| 3 | 25 | 45 | 0h 45m | 23 | 225 | 2,645 | 44h 05m |
| 4 | 35 | 80 | 1h 20m | 24 | 235 | 2,880 | 48h 00m |
| 5 | 45 | 125 | 2h 05m | 25 | 245 | 3,125 | 52h 05m |
| 6 | 55 | 180 | 3h 00m | 26 | 255 | 3,380 | 56h 20m |
| 7 | 65 | 245 | 4h 05m | 27 | 265 | 3,645 | 60h 45m |
| 8 | 75 | 320 | 5h 20m | 28 | 275 | 3,920 | 65h 20m |
| 9 | 85 | 405 | 6h 45m | 29 | 285 | 4,205 | 70h 05m |
| 10 | 95 | 500 | 8h 20m | 30 | 295 | 4,500 | 75h 00m |
| 11 | 105 | 605 | 10h 05m | 31 | 305 | 4,805 | 80h 05m |
| 12 | 115 | 720 | 12h 00m | 32 | 315 | 5,120 | 85h 20m |
| 13 | 125 | 845 | 14h 05m | 33 | 325 | 5,445 | 90h 45m |
| 14 | 135 | 980 | 16h 20m | 34 | 335 | 5,780 | 96h 20m |
| 15 | 145 | 1,125 | 18h 45m | 35 | 345 | 6,125 | 102h 05m |
| 16 | 155 | 1,280 | 21h 20m | 36 | 355 | 6,480 | 108h 00m |
| 17 | 165 | 1,445 | 24h 05m | 37 | 365 | 6,845 | 114h 05m |
| 18 | 175 | 1,620 | 27h 00m | 38 | 375 | 7,220 | 120h 20m |
| 19 | 185 | 1,805 | 30h 05m | 39 | 385 | 7,605 | 126h 45m |
| 20 | 195 | 2,000 | 33h 20m | 40 | 395 | 8,000 | 133h 20m |

### Commands

| Command | Rule | Errors (nothing changes) |
| --- | --- | --- |
| `UNLOCK_TRAINING_TIER {tier}` | `tier` must be current + 1 (bound to what the player saw: a double tap never buys two). Pays the price; gold stays a whole number ≥ 0. Event `TRAINING_TIER_UNLOCKED`. | `TIER_NOT_NEXT`, `MAX_TIER`, `NOT_ENOUGH_GOLD` (message says how much is missing), `INVALID_COMMAND` |
| `START_ACTIVITY {kind:'training', attribute}` | Same attribute again = no-op. Another attribute switches to it; every attribute keeps its XP. Stops any other activity first (a dungeon run in progress is lost). | `TRAINING_LOCKED` (tier 0), `TRAINING_MAXED` (at the tier cap), `UNKNOWN_ATTRIBUTE` |
| `STOP_ACTIVITY` | Pauses training. Trained XP is always kept (pauses, switches, sessions). | `NO_ACTIVE_ACTIVITY` |
| `SPEEDUP_TRAINING {minutes, maxCost}` (1.6.0) | Spends **1 stamina per minute** and adds `minutes × 60 000 ms` of training progress to the attribute being trained right away, through the normal level-up path (several level-ups, auto-stop at the cap). Minutes are **clamped** to `ceil(trained time left to the tier cap / 1 min)` and only those are charged. `maxCost` is the cost the button showed. The Training modal shows +1 min, +10 min and "To next level" (`ceil(remaining minutes)`) on the active row. Numbers: `TRAINING.speedup`. | `NOT_TRAINING`, `NOT_ENOUGH_STAMINA`, `INVALID_AMOUNT`, `COST_CHANGED`, `TRAINING_MAXED` |

### Time, cap and events

- Training is an activity, so **one activity at a time**: starting it stops woodcutting or cancels the dungeon run in progress; starting woodcutting or a dungeon stops training, and its XP is kept.
- It runs inside the same `simulate()` with the same clock rules as woodcutting: the **8 h offline cap** limits training time, a **backward clock pauses** it until real time catches up, invalid time is a no-op.
- `advanceTraining()` walks the granted time **level by level**: HP regenerates at the rate of the moment, and a level-up applies at its exact instant (an END level raises HP regen from then on). So many 1 s ticks and one big resume give the same state, byte for byte (tested). Regen then continues over the rest of the uncapped time, like dungeon runs.
- **Cap:** when the attribute reaches its tier's cap (20 × tier), training **stops by itself**: XP and `progressMs` are set to 0 (no XP beyond the cap, the remainder is dropped), the activity becomes null, and the engine emits `TRAINING_MAXED {attribute}` and `ACTIVITY_STOPPED`. Buying the next tier lets the player train it again (they press Train; it does not resume by itself).
- `TRAINING_LEVEL_UP {attribute, level}` is emitted for **each** level, also when several come in one `simulate()` call (8 h from level 0 = 9 level-ups).
- `SimulationSummary` gains `trainingXpGained`, `trainingLevelsGained` (per attribute) and `trainingMaxed` (attributes that hit the cap). Training XP or a cap counts as progress for "While you were away".
- No RNG; integer math only. The engine guard test still bans `Math.pow`, `**` and `Math.random`.

### UI selectors

`trainingView(state)` → tier, cap, next tier (price, affordable, missing gold), the active attribute, and per attribute: base, trained, effective, cap, XP / XP to next, fraction (remainder included), time to the next level, maxed, active. `activityView()` returns the same per-attribute view with `kind: 'training'` for the activity strip.

## Storage: SQLite as a document store

**Decision.** The owner prefers a MongoDB-style model because player attributes will keep growing. No MongoDB/Realm option runs in Expo Go (Realm and Atlas Device Sync are end-of-life), so we use **expo-sqlite** (bundled in Expo Go) as a document store:

- Aggregates are JSON documents in `documents(collection, id, doc, doc_version, updated_at)`. Adding a field to `GameState` needs no SQL schema change. `json_extract` queries fields directly (`SQLiteGameRepository.getStateField('$.character.name')`).
- SQLite gives atomic transactions, so a log row and the state it produced are always written together.
- The `('game_state','main')` document has the same shape as a future server MongoDB `players` document, so sync maps 1:1.

The repository talks to a small `SqlDatabase` interface. The app passes `expo-sqlite` (async API, `withExclusiveTransactionAsync`); tests pass Node's built-in SQLite, so the real SQL is under test.

### Save versions

`GameState.saveVersion` plus ordered pure migrations in `src/engine/migrations.ts` (`MIGRATIONS[n]` upgrades v`n` to v`n+1`). A save newer than the app is refused instead of being overwritten. To change the shape: bump `CURRENT_SAVE_VERSION`, add the migration and a frozen fixture of the old version under `tests/fixtures/`.

Current version: **8**.

- v1 → v2 adds `flags.debugUsed` (set to `false` for old saves).
- v2 → v3 (2026-10-26): attributes become strength→strength, dexterity→dexterity, constitution→endurance, intelligence→intelligence, each set to **max(old value, 10)** so old heroes match the new-hero baseline (owner decision); agility and charisma are dropped; `character.hp`/`maxHp` are dropped; `stamina` is added full (100/100); every equipped and inventory item gets a `defId` (stackables: their id; starting gear: `start-<defId>`). Literals in the migration are frozen on purpose, so later config changes cannot change what it produces.

- v3 → v4 (2026-10-26): `character.hp` = max HP at the hero's level (`50 + 10 × (level − 1)`, frozen literals), `character.hpRegenProgress = 0`, `dungeon = {lastFight: null, totals: 0/0/0}`. The activity is kept (v3 only had woodcutting, so no save is in a dungeon).
- v5 → v6 (2026-10-26): training. Adds `training = {tier: 0, attributes: {each: {level: 0, xp: 0, progressMs: 0}}}` (frozen literals, including the four attribute keys). Nothing else changes: stored attributes stay the base values, and v5 had no training activity.
- v6 → v7 (2026-10-27): trees and the axe slot. A running woodcutting activity becomes `{kind:'woodcutting', treeId:'oak', progressMs: 0}` (the banked part of one old 3 s action is dropped); the `axe` equipment slot gets the Wooden Axe (`start-wooden_axe`, frozen literals). Woodcutting level, XP, logs and everything else are kept.
- v7 → v8 (2026-10-27): merchant. `merchant = {charges: 5, chargeProgressMs: 0, stock}` with the 4 listings (Health Potion ×10 at 12, Iron Axe 600, Iron Sword 500, Iron Helm 400) in the first slots and as many slots as `inventory.capacity` (20 when missing); `nextItemSerial = 1`; the stale per-instance `rarity` is dropped from every equipped and inventory item. Frozen literals. Everything else is kept.
- v4 → v5 (2026-10-26): dungeon tiers. The dungeon id `rat_cellar_1` becomes `rat_cellar` (running activity and last fight). Every v4 run was a Rat Cellar run, so `dungeon.byDungeon = {rat_cellar: totals}` (empty when there were no runs) and the old wins count toward the Bat Cave unlock. `totals` is kept. Frozen literals again.

Frozen fixtures that must keep loading: `tests/fixtures/save-v1.json` and `tests/fixtures/save-v2.json` (made with the 1.1.0 engine: hero Lv4, woodcutting Lv8, 3785 logs, banked progress), `tests/fixtures/save-v3.json` (made with the 1.2.0 engine before the dungeon: hero Lv5, DEX 15, END 12, woodcutting running, 68 stamina), and `tests/fixtures/save-v4.json` + `log-v4.json` (made with the 1.3.0 engine before the tiers: hero Lv3, DEX 13, END 12, Rat Cellar running mid-run, 19 runs / 18 wins / 1 loss, plus the action log that produced it, all rows at engine 1.3.0), and `tests/fixtures/save-v5.json` + `log-v5.json` (made with the 1.4.0 engine before training: hero Lv4, 198 gold, DEX 12, END 13, Bat Cave running mid-run, Rat Cellar 25 wins, Bat Cave 8 wins, plus its 11-row action log, all at engine 1.4.0), and `tests/fixtures/save-v6.json` + `log-v6.json` (made with the 1.5.0 engine before the trees: woodcutting Lv5 running mid-action, 1,338 Oak Logs, 9 nests, STR trained to 4, 94 stamina, plus its 10-row action log, all at engine 1.5.0), and `tests/fixtures/save-v7.json` + `log-v7.json` (made with the 1.6.0 engine before the merchant: Oak running mid-log, 1,120 gold, 123 Oak Logs, 12 Rat Skins, 24 Rat Cellar wins, plus its 9-row action log, all at engine 1.6.0).

**Rules version.** `ENGINE_VERSION` (`src/engine/version.ts`) is written on every log row. Bump it whenever rules change outcomes. **Every save-version bump also bumps `ENGINE_VERSION`** (`RELEASED_ENGINES` in `src/engine/version.ts`: save v1 → 1.0.0, v2 → 1.1.0, v3 → 1.2.0, v4 → 1.3.0, v5 → 1.4.0, v6 → 1.5.0, v7 → 1.6.0, v8 → 1.7.0; a guard test in `tests/golden.test.ts` checks it), so a replay span never mixes two save shapes under one engine version. `tests/golden.test.ts` pins the final state hash of a fixed seed and script, so an unintended rules change fails CI. 1.1.0: XP curve uses `L × √L`, and `flags.debugUsed` was added. 1.2.0 (2026-10-26): save v3, stamina regen in `simulate()`, stamina/attribute debug commands; woodcutting outcomes unchanged (same actions, levels and drops in the golden script). The golden script now also spends stamina and adds STR, so the hash changed. 1.3.0 (2026-10-26): save v4, HP regen, dungeon runs and combat. Woodcutting outcomes unchanged (same actions, levels, nests and stamina in the golden script); the script gained a dungeon segment (start, skip, HP debug, 3 h of runs, woodcutting cancelling a run), so the hash changed. 1.4.0 (2026-10-26): save v5, dungeon tiers 1–5, per-dungeon counters, unlocks, `DEBUG_ADD_DUNGEON_WINS`, MIGRATE anchors. Rat Cellar outcomes unchanged (a golden test pins the 1.3.0 part of the script: same runs, gold, HP, stamina, level); the hash changed because of `byDungeon` and the id rename. The script gained a tier segment (debug wins, Bat Cave runs). 1.5.0 (2026-10-26): save v6, training (tiers, per-attribute levels, effective attributes in every rule), `UNLOCK_TRAINING_TIER`, `DEBUG_ADD_TRAINING_XP`, `DEBUG_ADD_GOLD`. Every 1.4.0 outcome is unchanged (a golden test pins the whole 1.4.0 script: actions, runs, gold, HP, stamina, levels, loot); the hash changed because of the `training` field. The script gained a training segment (Tier 1, STR, switch to END, debug XP and gold, Tier 2, 10 h capped, debug XP to the cap, a Rat Cellar hour with trained attributes). 1.6.0 (2026-10-27): save v7, woodcutting trees, WS, axe slot, `SKIP_WOODCUT`, `SPEEDUP_TRAINING`, `DEBUG_ADD_WOODCUTTING_LEVEL`. Woodcutting outcomes changed on purpose (Oak 1:50 / 25 XP instead of 3 s / 10 XP), so far fewer nest rolls happen and the RNG stream shifts: the earlier golden pins were re-pinned (dungeon runs, wins, levels, HP, stamina unchanged; gold differs). The script gained a 1.6.0 segment (Oak, bound skip, +4 WC levels, Birch, STR speed-up +10 min and to next level). 1.7.0 (2026-10-27): save v8, merchant (refresh charges, stock, `BUY_ITEM`, `SELL_ITEM`, `REFRESH_MERCHANT`), `EQUIP_ITEM`, `UNEQUIP_ITEM`, `USE_ITEM`, `DEBUG_ADD_MERCHANT_CHARGE`, item quality and prices in the catalog. Every 1.6.0 outcome is unchanged (a golden test pins the whole 1.6.0 script); the hash changed because of the new fields and the dropped `rarity`. The script gained a 1.7.0 segment (debug gold, buy potions and the Iron Axe, equip it, potion, sell logs and the Wooden Axe, refreshes, 5 h of charge regen, debug charge, a buy and equip while woodcutting).

**Known limit, still open:**
- The SQL schema has only `schema_version = 1` in `meta` and `CREATE TABLE IF NOT EXISTS`. Add ordered SQL schema migrations keyed on `meta.schema_version` before the first table change.

## Action log & sync

`action_log(seq, command_id UNIQUE, type, payload JSON, client_time, engine_version, state_hash, synced)` is append-only. Every stored state change is one transaction: log row(s) + state document. Never one without the other.

| type | When | Payload |
| --- | --- | --- |
| `NEW_GAME` | First launch, Reset save | `{ seed }` (`+ reason, debugUsed: true` after Reset save) |
| `START_ACTIVITY`, `STOP_ACTIVITY`, `SKIP_DUNGEON_RUN`, `SKIP_WOODCUT`, `SPEEDUP_TRAINING`, `DEBUG_ADD_WOODCUTTING_LEVEL`, `EQUIP_ITEM`, `UNEQUIP_ITEM`, `USE_ITEM`, `REFRESH_MERCHANT`, `BUY_ITEM`, `SELL_ITEM`, `DEBUG_ADD_MERCHANT_CHARGE`, `UNLOCK_TRAINING_TIER`, `DEBUG_ADD_TRAINING_XP`, `DEBUG_ADD_GOLD`, `DEBUG_GRANT_HERO_XP`, `DEBUG_SPEND_STAMINA`, `DEBUG_REFILL_STAMINA`, `DEBUG_ADD_ATTRIBUTE`, `DEBUG_SET_HERO_HP`, `DEBUG_FINISH_DUNGEON_RUN`, `DEBUG_ADD_DUNGEON_WINS` | Player/debug commands; `command_id` = command id | the command |
| `MIGRATE` | `load()` found a save that needed a migration, or `meta.engine_version` ≠ `ENGINE_VERSION`. Written in the same transaction as the migrated state and the new `engine_version` | `{ fromSave, toSave, fromEngine, toEngine, snapshot }` (snapshot = full post-migration GameState) |
| `RESUME` | App start, back from background, debug clock change. Skipped when no time passed and there was no anomaly | `{ summary }` |
| `SIMULATE` | Live-play checkpoint: every 30 s while an activity runs (every 10 min when idle), before any other row, on background | `{ checkpoint: true }` or `{ summary }` |
| `CLOCK_ANOMALY` | Any anomaly from a resume, or the first one seen while ticking | the anomaly event |
| `DEBUG_CLOCK_OFFSET`, `DEBUG_RESET_SAVE` | Debug panel | `{ deltaMs, offsetMs }` / `{}` |

`state_hash` is the hash of the state **after** the row. Replaying rows in order with `replayLog` (engine) reproduces every hash: commands go through `applyCommand(state, payload, client_time)`, `RESUME`/`SIMULATE` through `simulate(state, client_time)`, `CLOCK_ANOMALY` changes nothing, and `DEBUG_CLOCK_OFFSET` / `DEBUG_RESET_SAVE` only set `flags.debugUsed`. Replay accepts `DEBUG_*` rows even in a build with `DEV_TOOLS_ENABLED = false`, so a log never becomes unreplayable. Tested on both the memory and SQL repositories.

### Replay anchors (engine-version spans)

**Rule: a replay is only valid within one engine-version span; MIGRATE anchors stitch the spans together.** Rows written by engine 1.3.0 mean 1.3.0 rules (and 1.3.0 ids such as `rat_cellar_1`); running them on 1.4.0 rules would diverge or fail. So:

- On `load()`, when the stored save needed a migration or `meta.engine_version` differs from `ENGINE_VERSION`, the client writes a **`MIGRATE`** row whose payload carries the full post-migration state (`snapshot`) and whose `state_hash` is that snapshot's hash, in the same transaction as the migrated document and the new `engine_version`. If that commit fails, nothing changes and the next load tries again. A fresh install writes `NEW_GAME` instead; a load with the same engine and save version writes nothing.
- The payload also carries `fromHash`, the hash of the stored document before migration, which equals the last log row's `state_hash`.
- `replayStep(state, entry, prev)` on a `MIGRATE` row runs `checkAnchor` and then resets to the snapshot (through `loadSave`, in case a later save version reads it). An anchor is **rejected** unless all of these hold:
  - the row has `engineVersion` (= `toEngine`) and a `stateHash` equal to the snapshot's hash;
  - there is a previous row, with `engineVersion` and `stateHash`;
  - `fromHash` = the previous row's `stateHash`, and `fromEngine` = its `engineVersion`;
  - it is an engine change: `fromEngine ≠ toEngine` (every save bump ships with an engine bump), both are released, in order, and `fromSave` / `toSave` (= the snapshot's `saveVersion`) are the save versions `RELEASED_ENGINES` lists for them;
  - when the span before it was re-simulated, `hashState(loadSave(replayed)) = hashState(snapshot)`.
- `replayLogReport(entries)` requires `engineVersion` on **every** row (a missing one is an error) and splits the log into spans that start at `NEW_GAME` or `MIGRATE`. A span written entirely by the current engine is re-simulated and every row's `stateHash` is checked; any other span is **not re-simulated** and is counted in `skippedOldEngine`. Rows from another engine after the last anchor are an error.
- A skipped span may mix older released engines (real pre-1.4.0 logs mix 1.2.0 and 1.3.0 rows with no anchor between them), but it may **not** contain a current-engine row: a genuine log always anchors on entry to the current engine.
- Every `engineVersion` must appear in **`RELEASED_ENGINES`** (`src/engine/version.ts`: each shipped engine and the save version it wrote, oldest first; append a row on every bump) and be no newer than `ENGINE_VERSION`, and versions **never decrease** along the log. Otherwise the client-written label could decide which spans get skipped.
- **Trust boundary:** labels are still client-written. A forger can relabel an entire log as an older released engine (back to `NEW_GAME`), and the device then skips it and only chain-checks the anchor after it. So any log stays client-trusted in that respect until a server re-simulates old spans with archived engine builds (see the exploit table).
- A future server keeps old engine builds (or trusts its own earlier verification) for the old spans; the anchors are where it switches.

**Live play.** While the app is open, `tick()` runs every second through the same `simulate()`. Ticks stay in memory and are checkpointed every 30 s and when the app goes to the background, so the log does not grow by one row per second. If the app is killed in between, nothing is lost: the next launch re-simulates from the last stored state to now, which gives the same result (determinism).

**Retention (planned, not implemented in M1).** The log grows by about 2 rows per 30 s of active play plus a few rows per session, which is a few MB per year of heavy play. Once sync exists: delete rows that are `synced = 1` and older than 30 days, never unsynced rows, and **never the latest span start (`NEW_GAME` or `MIGRATE`) or anything after it**, nor the row just before a `MIGRATE` (its anchor checks `fromHash` / `fromEngine` against that row). A server that holds the full history can still replay. Until sync ships, nothing is deleted.

**Sync readiness.** `SyncTransport.pushLog(rows) → acked seqs`, `LocalGameClient.getUnsyncedLog()` and `syncOnce(transport)` exist. M1 ships `NoopSyncTransport`; nothing leaves the device.

## "While you were away"

Shown after app start, a return from background or a debug clock change when **at least 60 s of real time passed and there was at least one gathering action, dungeon run, training XP point or training cap reached** (`AWAY_SUMMARY_MIN_MS` in `config/time.ts`), or when there was **any clock anomaly**. A quick app switch is still simulated and logged, but opens no modal. It lists logs cut and the count per log type, dungeon runs (won/lost), dungeons unlocked, hero XP, gold and loot next to gathering results, plus training XP and levels per attribute and a "maxed — unlock Tier N" note for each attribute that hit its cap.

The summary is an RN `<Modal>`. On iOS it presents from the view controller that owns it, and the root controller cannot present while a full-screen village modal is up, so each village modal route renders its own `<AwayModal />` and the root one hides on those routes (`RootAwayModal` in `src/app/_layout.tsx`).

## Debug tools

`DEV_TOOLS_ENABLED` in `src/engine/config/dev.ts` shows a Debug panel on the Hero tab. It stays on for the POC. Any `DEBUG_*` action sets `state.flags.debugUsed = true` forever (it survives later play, Reset save and replay), so a future server can tell debugged saves apart. The clock buttons change a persisted **offset** on the client clock (`SystemClock.offsetMs`), then resume, so the engine sees exactly what a player who changed the phone clock would produce. "+10k hero XP" is a real logged command (`DEBUG_GRANT_HERO_XP`), and so are "Spend 10 stamina" (`DEBUG_SPEND_STAMINA`, refused with `NOT_ENOUGH_STAMINA` below 10), "Refill stamina" (`DEBUG_REFILL_STAMINA`), "+1 STR / DEX / END / INT" (`DEBUG_ADD_ATTRIBUTE`, 1–1000 per command, an attribute can reach at most 1,000,000), "Hero HP → 1" (`DEBUG_SET_HERO_HP`, 0..max, clears the regen remainder) and "Finish run now (free)" (`DEBUG_FINISH_DUNGEON_RUN`, resolves the current run's fight like a skip without stamina; refused with `NO_DUNGEON_RUN` when no dungeon runs). In a dungeon's detail view, "+10 wins (debug)" (`DEBUG_ADD_DUNGEON_WINS`, 1–1000 per command, unlocked dungeons only) adds wins and runs to that dungeon's counters with no fight and no rewards, so unlocks can be tested on the phone. "+60 min training XP" (`DEBUG_ADD_TRAINING_XP {xp}`, 1–100,000 per command) adds training XP to the attribute being trained right away, with the same level-ups and cap rule as real time (refused with `NOT_TRAINING` when nothing trains); "+1 WC level" (`DEBUG_ADD_WOODCUTTING_LEVEL {levels}`, 1–100 per command, level at most 1,000, XP toward the next level kept) to test tree unlocks; "+1,000 gold" (`DEBUG_ADD_GOLD {amount}`, 1–1,000,000 per command, gold at most 10¹²). In the Merchant's Buy tab, "+1 merchant refresh (debug)" (`DEBUG_ADD_MERCHANT_CHARGE`, never above max; refused with `CHARGES_FULL`). "Reset save" logs `DEBUG_RESET_SAVE` + `NEW_GAME` and clears the offset; it never deletes log rows. None of them change engine rules.
