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
| d | `elapsed > offline.capMs` (8 h): grant exactly the cap, emit `CLOCK_ANOMALY {kind:'forward_capped', requestedMs, grantedMs}`, set `lastSimulatedAt = now`. The excess is forfeited, never banked. Exception (1.9.0): a dungeon **fight** in progress when the cap is reached is finished (see "Runs (auto-repeat)"). The builder, the worker crews and their upkeep (1.10.0) use the granted time like every activity. |
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
hero growth:  levels 1–19 → 1.00 · 20–39 → 1.05 · 40–99 → 1.07 · 100+ → 1.18
skill growth: levels 1–14 → 1.00 · 15–39 → 1.07 · 40–99 → 1.08 · 100+ → 1.18   (since engine 1.12.0)
```

`L^1.5` is computed as `L × Math.sqrt(L)`: multiplication and `sqrt` are exactly rounded in IEEE 754, so Hermes (phone) and V8 (a Node server) get identical bits, while `Math.pow` may differ between runtimes. A guard test bans `Math.pow`, `**`, `exp`, `log` and trig functions in `src/engine`. Hero `base = 100` (since engine 1.8.0; it was 1500). Skills `base = 100` with their own growth segments since engine 1.12.0 (were base 500 on the hero's segments). No level cap. Values above `Number.MAX_SAFE_INTEGER` clamp to it; that only happens far beyond level 150. Big numbers are a backlog item. Data: `src/engine/config/xpCurve.ts`.

Owner's target (2026-10-27): a new player reaches hero **Lv5 in the first minutes** by spending the 100 starting stamina. Lv5 needs 1,703 XP = **49 Rat Cellar wins** (35 XP each). With the skip rule (2 stamina per 1:50 search, no regen for the skipped time) the pace is set by HP, not stamina: a sim that skips only at ≥ 10 HP reaches Lv5 after 50 straight wins in about 17 minutes. The older long-range target (~2 days to Lv20, > 1 year to Lv100) was set for base 1500 and has not been re-checked. Hero XP comes from combat only (M4); gathering gives skill XP and items.

| Level | Hero xpToNext | Hero XP to reach this level |
| ---: | ---: | ---: |
| 1 | 100 | 0 |
| 2 | 283 | 100 |
| 3 | 520 | 383 |
| 4 | 800 | 903 |
| 5 | 1,118 | 1,703 |
| 10 | 3,162 | 11,106 |
| 20 | 8,944 | 67,135 |
| 30 | 26,765 | 224,199 |
| 40 | 67,124 | 647,694 |
| 50 | 184,535 | 1,757,968 |
| 60 | 477,187 | 4,706,709 |
| 80 | 2,842,969 | 30,310,092 |
| 100 | 15,374,912 | 173,496,928 |
| 110 | 92,837,138 | 567,180,372 |
| 120 | 553,636,428 | 2,926,467,270 |

**Skill curve (woodcutting, mining; engine 1.12.0).** Owner target (2026-10-31): Lv1 → 15 within one day of continuous gathering (offline included), early levels quick; the late game may be harder. Hours = continuous gathering on Oak to Lv5, then Birch (the plain path, no gear: Maple from Lv15 needs WS 450, so those columns are an upper bound), from `tests/migrationV12.test.ts`. The old curve (base 500) needed 159,989 XP ≈ 117 h for Lv15.

| Skill level | xpToNext | XP to reach this level | Hours, DEX 0 | Hours, DEX 10 (new hero) | Old curve: XP to reach |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 1,118 | 1,703 | 2.3 | 2.1 | 8,512 |
| 10 | 3,162 | 11,106 | 8.9 | 8.4 | 55,524 |
| 15 | 5,809 | 31,998 | **23.5** | **22.6** | 159,989 |
| 20 | 12,545 | 72,891 | 52.1 | 50.3 | 335,676 |
| 30 | 45,336 | 317,081 | 223.1 | 215.6 | 1,120,995 |

The skill curve is cheaper than the old one at every level (test), so the v11 → v12 migration never lowers a level.

Woodcutting XP per log depends on the tree (see "Woodcutting"); the old 3 s / 10 XP rule is gone since engine 1.6.0.

## Attributes & derived stats

The hero has 4 attributes, stored as plain integers in `character.attributes`: `strength`, `dexterity`, `endurance`, `intelligence`. A new hero starts at 10 in each. That stored value is the **base**; Training adds its level on top (see "Training"). **Every rule reads the effective value, base + trained** (`effectiveAttributes()`), and the formulas below use it.

| Attribute | Effect today |
| --- | --- |
| Strength | +1 flat damage per point (min and max) |
| Endurance | +1 flat defense per point, +1 HP regen per minute |
| Strength | also +1 woodcutting strength and +1 mining strength per point |
| Dexterity | −1 s dungeon search time per point (minimum 60 s), −1 s per log cut and per ore mined (minimum 10 s each) |
| Intelligence | −crafting time on a diminishing curve (1.13.0): `diminishingBp(INT, 5000, 50)` = 833 bp at INT 10, 2500 at 50, 3333 at 100, 4038 at 210; never reaches 50% |

**Diminishing helper (1.13.0).** `diminishingBp(value, capBp, k) = floor(capBp × value ÷ (value + k))` (`src/engine/diminishing.ts`): integer basis points, 0 for value ≤ 0, half the cap at value = k, never the cap. Parameters are data (`STAT_EFFECTS` in `config/stats.ts`, e.g. `STAT_EFFECTS.intelligence.craftTime = { capBp: 5000, k: 50 }`) so other attributes can use it later. **Reductions stack multiplicatively**: each applies to what the previous left (craft time = base × house × (1 − INT)), never added together.

**Derived stats are computed, never stored.** `getDerivedStats(state)` (`src/engine/stats.ts`) returns `damage {min, max}`, `defense`, `attackIntervalMs`, `maxHp` and `maxMana`, each with a `breakdown` whose parts add up to the final number (the Hero tab shows it on tap). Coefficients: `src/engine/config/stats.ts`.

```
damage  = round(weapon.damage  × (1 + Σ percent)) + STR × 1        (each of min and max; effective STR)
defense = round(Σ equipped armor × (1 + Σ percent)) + END × 1        (effective END)
maxHp   = 50 + 10 × (level − 1)
maxMana = 20 + 5 × (level − 1)
attackIntervalMs = max(200, 1000 + Σ attackIntervalModMs of equipped items)     (ms between hero strikes)
```

- **Attribute points are flat FINAL bonuses**: percent bonuses scale only the base (gear) part, never the STR/END part (owner decision; tested).
- **Unarmed** (no weapon, or a weapon `defId` the catalog does not know): 1–2.
- **Gear bonuses (planned, M4).** Base item stats come from the catalog. Rolled affixes on dropped items will be stored on the item instance. Flat affixes ("+3 damage", "+2 armor") will add to the **base** part, before percent bonuses. Percent affixes ("+5% armor") join the percent list. Attribute points always stay last, unscaled. Confirm this order when loot ships.
- **Percent bonuses** are integer basis points (`1000` = +10%) collected by `percentBonuses(state)`. The list is empty today; future upgrades plug in there. They are summed and rounded once, so the breakdown has a single `percent` line whose `bonuses` field lists every source and its bp. Rounding is integer half-up, `floor((base × (10000 + Σbp) + 5000) / 10000)`, with the factor floored at 0. No `Math.pow`.
- New hero: damage 12–14 (2–4 Rusty Gladius + 10 STR), defense 13 (2 Linen Tunic + 1 Worn Sandals + 10 END), HP 50, mana 20, one strike per 1.0 s.
- **Attack interval** (1.8.0): base 1000 ms (`STATS.attackInterval`), floor 200 ms. Gear can change it through the optional catalog field `attackIntervalModMs` (negative = faster); no item sets one yet. The Hero tab shows it as "Attacks every 1.0s" with its breakdown.
- **Current HP is stored (save v4), max HP is not.** `character.hp` is clamped to the derived max; a level-up raises the max, not the current value. See "Dungeon & combat" for regen. There is no current mana yet.

### Item catalog

Max item stats (`damage`, `armor`, `woodcuttingStrength`, `miningStrength` at 100% quality) live only in the catalog `ITEMS` (`src/engine/config/items.ts`), keyed by definition id. Every stored item carries `defId`; stats are looked up through it and never copied onto the instance, so a balance change needs no save migration. Inventory stacks merge by `defId`. Since 1.14.0 every **gear** instance (anything with a slot, tools included) also carries its own `rarity` and `qualityBp`, and every reader scales the catalog stat by it (see "Gear: quality and rarity"). Rolled affixes (later) will live on the instance too. A stored item with extra stat fields is ignored (tested).

| defId | Slot | Max stats (100%) | At 25% (pre-1.14.0) |
| --- | --- | --- | --- |
| `rusty_gladius` | weapon | damage 3–6 | 2–4 |
| `iron_chestplate` / `iron_shield` / `iron_gloves` / `iron_boots` (1.10.0) | armor / shield / gloves / boots | armor 10 / 8 / 3 / 3 | 6 / 5 / 2 / 2 |
| `steel_axe` / `steel_pickaxe` (1.10.0) | axe / pickaxe | WS / MS +192 | +120 |
| `steel_sword` (1.10.0) | weapon | damage 16–22 | 10–14 |
| `greater_health_potion` (1.10.0) | — (stackable, usable) | heals 60 HP | |
| `linen_tunic` / `worn_sandals` | armor / boots | armor 3 / 2 | 2 / 1 |
| `wooden_axe` / `wooden_pickaxe` | axe / pickaxe | WS / MS +2 | +1 |
| `iron_axe` / `iron_pickaxe` | axe / pickaxe | WS / MS +64 | +40 |
| `iron_sword` | weapon | damage 10–14 | 6–9 |
| `iron_helm` | helmet | armor 6 | 4 |
| `<set>_<piece>` (1.14.0, crafted) | see "Gear crafting" | | |
| `health_potion_t1` | — (stackable, usable) | heals 50 HP, capped at max | |

Description and base prices are catalog-only; the catalog `rarity` is the default a gear instance overrides. See "Merchant & economy".

## Merchant & economy

Data: `src/engine/config/items.ts` (rarity, description, `sellPrice`, `buyPrice`, `heal`) and `src/engine/config/merchant.ts` (charges, stock pool). Rules: `src/engine/merchant.ts` (stock, charges, buy, sell) and `src/engine/equipment.ts` (equip, unequip, use). The merchant is **not an activity**: every command below works while woodcutting, training or a dungeon runs, and never touches `state.activity`.

### Rarity

`rarity` (renamed from the catalog's `quality` in 1.14.0, type `ItemRarity`) is the colour tier. A gear instance's own `rarity` overrides the catalog's (`rarityOf(item)`).

| Rarity | Color (`rarityColors` in `src/theme.ts`) | Meaning | Items |
| --- | --- | --- | --- |
| junk | gray `#b0a89c` | sell-only, no game use | Rat Skin, Bat Wing, Wolf Pelt, Old Bone, Troll Hide, Bread |
| common | white `#f5efe2` | has a game use (gear, crafting, consumables) | all logs, Stone and ores, catalog gear, Health Potion |
| uncommon | green `#6fcf62` | rarity tier | Bird Nest, Geode; rolled gear |
| rare / epic / legendary | blue `#6fb0ff` / purple `#c79bf2` / dark yellow `#e0b030` | rarity tiers | rolled gear (rare from the Merchant, up to epic from crafting) |

Every color passes 4.5:1 on `colors.sheet`, `colors.slot` and `colors.night`, the dark panels where names appear (`tests/theme.test.ts`). Item names and slot frames use the instance's colour.

### Gear: quality and rarity (1.14.0)

Data: `src/engine/config/gear.ts` (`GEAR`, `GEAR_SETS`, `GEAR_PIECES`). Rules: `src/engine/gear.ts`. Owner-approved 2026-11-01, save v14.

```
gear          = an item whose catalog entry has a slot (weapons, armor, axes, pickaxes)
instance      = { …, rarity, qualityBp (0..10 000) }                     every gear instance, equipped or not
stat          = max(1, floor((max × (10 000 + q) + 10 000) ÷ 20 000))     = round(max × (5000 + q/2) / 10 000), half up
                damage min and max both scale; attackIntervalModMs does not
price         = floor(price × (8000 × 10 000 + 8000 × q) ÷ 10^8)          0.8× at 0%, 1.0× at 25%, 1.6× at 100%
sell          = floor(max(1, price(sellPrice, q)) × (10 000 + sell bonus) ÷ 10 000)    (the Town Hall bonus after it)
```

- **25% = the old numbers.** Catalog gear stats became 100% maxima (`round(old × 1.6)`); at 2500 bp every pre-1.14.0 item gives exactly its old stat and price (a catalog-wide test). Every pre-1.14.0 instance, starting gear and the starter stock are 2500 / common.
- **Readers** (all through `gearStats(item)` / `baseSellPrice(item)`): derived damage and defense (`getDerivedStats`), WS (`axeBonus`) and MS (`pickaxeBonus`), and so crew power, tree / rock access and the "stop when WS / MS drops" rule; `sellPriceOfItem(state, item)` (SELL_ITEM, the Sell tab); popovers and equip deltas. `sellPriceOf(state, defId)` stays for non-gear.
- **Invariants (tested):** any gear instance sells for less than it costs at the same quality, with the Town Hall bonus; every gear recipe's piece at 100% with +20% sells for less than its inputs. A 0% piece still sells for 1.
- **Merchant rolls.** Gear listings hold one piece with `qualityBp` uniform 0..5000 and rarity common 70 / uncommon 25 / rare 5 (never epic+); the unit price is scaled and fixed when the stock is rolled. The rolls draw from their **own stream**: `{seed: (main RNG after the picks) XOR GEAR.merchant.rollSalt}`, one quality draw then one rarity draw per gear listing in stock order; the main RNG advances exactly as before (so drops, yields and combat don't shift; this also lets the golden test pin the 1.13.0 script). Non-gear listings are unchanged.
- **Mob drops** (not yet): `GEAR.drops.maxQualityBp = 7000`, unused.

### Prices (gold, integers)

| Item | Sell | Buy |
| --- | --- | --- |
| Rat Skin / Bat Wing / Wolf Pelt / Old Bone / Troll Hide | 2 / 5 / 12 / 25 / 60 | — |
| Oak / Birch / Maple / Yew / Ironwood Logs | 1 / 3 / 8 / 20 / 50 | — |
| Stone / Copper / Iron / Silver / Gold Ore | 1 / 3 / 8 / 20 / 50 | — |
| Bird Nest / Geode | 30 / 30 | — |
| Health Potion (T1) | 5 | 12 |
| Iron Axe / Iron Pickaxe / Iron Sword / Iron Helm | 180 / 180 / 150 / 120 | 600 / 600 / 500 / 400 |
| Iron Chestplate / Shield / Gloves / Boots (1.10.0) | 210 / 165 / 75 / 75 | 700 / 550 / 250 / 250 |
| Greater Health Potion (1.10.0) | 9 | 30 |
| Steel Axe / Steel Pickaxe / Steel Sword (1.10.0) | 750 / 750 / 600 | 2,500 / 2,500 / 2,000 |
| Rusty Gladius / Linen Tunic / Worn Sandals / Wooden Axe / Wooden Pickaxe / Bread | 3 / 2 / 1 / 1 / 1 / 1 | — |

Gear prices in this table are at 25% quality; an instance's price scales with its quality (see "Gear: quality and rarity"). Every buyable item sells for less than it costs (tested), so no buy→sell loop prints gold. Since 1.10.0 the merchant pays **`sellPriceOf()` = floor(sellPrice × (1 + sell bonus))**: the Town Hall's Lv2+ bonus is +20% (see "Building bonuses"); every price stays below its buy price at the largest bonus any level gives (tested). The new 1.10.0 items sell for 30% of their price, floored.

### State (save v8)

`state.merchant = { charges, chargeProgressMs, stock }` and `state.nextItemSerial`.

- `stock` has one entry per slot; each is `{ defId, quantity, unitPrice }` (gear since 1.14.0: `quantity: 1` plus `qualityBp` and `rarity`) or `null` (empty or bought out). The price is fixed when the stock is rolled (the catalog `buyPrice`, scaled by quality for gear). Buying a gear listing gives an instance with its roll.
- **Random stock (1.10.0).** `rollStock(rng, slots)`: slot 1 is always `MERCHANT.fixed` (Health Potion ×10); the other `slots − 1` are drawn from `MERCHANT.pool` with the seeded RNG, one draw per pick from the entries still left, so **no duplicates** (slots beyond the pool stay empty). The pool: Iron Axe, Iron Pickaxe, Iron Sword, Iron Helm, Iron Chestplate, Iron Shield, Iron Gloves, Iron Boots, Greater Health Potion ×5, Steel Axe, Steel Pickaxe, Steel Sword. The slot count comes from the Merchant building's level: **5 + 2 × (level − 1)** (13 at Lv5 = the whole pool). `REFRESH_MERCHANT` rolls a new stock and stores the advanced RNG.
- A **new save** starts with `starterStock(5)`: Health Potion ×10, Iron Axe, Iron Pickaxe, Iron Sword, Iron Helm, not rolled (newGame draws nothing), so a new hero always finds the iron tools that open the second tree and rock.
- When the Merchant reaches a level with more slots, `growStock()` fills the new slots at once from the pool (seeded, no duplicate of a listing still in stock). A pre-1.10.0 stock (20 slots, 5 listings) is kept as it is until the next refresh.
- Bought unique items get the instance id `<defId>#<n>` from `nextItemSerial`, which only goes up.

### Refresh charges

- **+1 every 2 h, max 5** (`chargeIntervalMs`, `maxCharges`). Charges beyond the max are lost; at max `chargeProgressMs` is 0 (time spent full is not banked), so spending from full starts a fresh 2 h timer.
- Regen runs in `simulate()` on the accepted, **uncapped** time, exactly like stamina: not limited by the 8 h offline cap (the max bounds it), no regen while the clock is behind (rules b, c), remainder kept across resumes.
- `merchantView(state)` gives the UI `charges`, `maxCharges`, `full`, `nextInMs` and the stock.

### Commands

| Command | Effect | Errors (nothing changes) |
| --- | --- | --- |
| `REFRESH_MERCHANT` | −1 charge, `stock = rollStock(rng, merchant stock slots)` (seeded) | `NO_REFRESH_CHARGES` |
| `BUY_ITEM {slot, defId, quantity, maxUnitPrice}` | gold −= unitPrice × quantity; stackables merge into their stack, unique items each take a slot; the listing's quantity drops, a bought-out slot becomes `null` | `UNKNOWN_SLOT`, `SLOT_EMPTY`, `STOCK_CHANGED` (another item is in the slot now), `INVALID_AMOUNT` (quantity outside 1..left), `PRICE_CHANGED` (price above `maxUnitPrice`), `NOT_ENOUGH_GOLD`, `INVENTORY_FULL` |
| `SELL_ITEM {itemId, quantity}` | gold += sellPriceOf(defId) × quantity (catalog price + building bonus, floored); the stack shrinks or goes | `ITEM_EQUIPPED` (unequip first), `NOT_IN_INVENTORY`, `NOT_SELLABLE` (unknown to the catalog), `INVALID_AMOUNT` (outside 1..owned) |
| `EQUIP_ITEM {itemId}` | the item moves to its catalog slot; the item that was there takes its inventory place (no free slot needed, nothing lost) | `NOT_IN_INVENTORY`, `NOT_EQUIPPABLE` |
| `UNEQUIP_ITEM {slot}` | the item moves to the end of the inventory | `UNKNOWN_SLOT`, `SLOT_EMPTY`, `INVENTORY_FULL` |
| `USE_ITEM {itemId}` | potions: hp = min(max, hp + heal), −1 unit; at max the regen remainder is cleared | `NOT_IN_INVENTORY`, `NOT_USABLE`, `HP_FULL` |
| `DEBUG_ADD_MERCHANT_CHARGE` | +1 charge, sets `debugUsed` | `CHARGES_FULL`, `DEBUG_DISABLED` |

**Gathering stop rule:** after `EQUIP_ITEM` / `UNEQUIP_ITEM`, if woodcutting runs and WS is now below the tree's `reqWs` (or mining runs and MS is below the rock's `reqMs`), the activity stops (`ACTIVITY_STOPPED`). Logs finished before the command are already banked (the command simulates to `now` first); the log in progress is dropped like any stop. WS cannot drop anywhere else (an equipped item can't be sold; STR only goes up), so `simulate()` needs no check.

`BUY_ITEM` carries `defId` as well as `maxUnitPrice`, so a tap on a stale screen never buys a different item than the one shown. Derived stats, woodcutting strength and search times read the equipment, so they follow every equip/unequip at once.

## Stamina

`state.stamina = { current, max, progressMs }`. A new hero starts at 100/100. `max` is stored per player (a future upgrade can raise it); it is 100 for everyone today. Data: `src/engine/config/stamina.ts`; rules: `src/engine/stamina.ts`.

- **Regen: +1 every 5 minutes** (`regenIntervalMs = 300000`), never above max. The remainder stays in `progressMs`, so no partial time is lost between resumes (many small resumes = one big one; tested).
- **At max, `progressMs` stays 0.** Time spent full is not banked; the 5-minute timer starts when stamina is spent.
- Regen runs inside `simulate()` on the **accepted** elapsed time, so it follows the same time rules as woodcutting: clock moved back (rule b) or jitter (rule c) → no regen, paused until real time catches up; invalid time (rule e) → no-op.
- **Not limited by the 8 h offline cap (rule d).** Stamina uses `requestedMs`, not the capped `grantedMs`. Why: the cap exists so idle *rewards* cannot pile up without limit. Stamina already has its own hard limit (max 100 = 8h20 from empty), so a long absence simply fills the bar, which is what a returning player expects. Capping it too would only matter for the 20 minutes between 8h and 8h20, and would make the bar look broken after a long break. Clock-forward abuse gains at most one full bar per jump, the same order as the activity cap, and is closed by server-owned time like the rest (see exploit table).
- `spendStamina(state, amount)` returns `{ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' | 'INVALID_AMOUNT' } }` instead of mutating. Callers simulate to `now` first (`applyCommand` does), so regen up to that moment counts.
- **Spent to skip a dungeon search, skip a log (see "Woodcutting") or an ore (see "Mining"), or speed up training** (see "Dungeon & combat"). The old planned costs (run 10, boss 25) are gone. Waiting is always free.
- `staminaView(state)` gives the UI `nextInMs` (to the next point) and `fullInMs` (to a full bar).

## Dungeon & combat

Data: `src/engine/config/dungeons.ts` (`DUNGEON_RUN` skip rule, `COMBAT`, `ENEMIES`, `DUNGEONS` with each dungeon's search timing, unlock rule and rewards, `DANGER` thresholds). Rules: `src/engine/dungeon.ts` (runs, the live fight loop, per-dungeon counters, unlocks), `src/engine/combat.ts` (strike timing and damage), `src/engine/hp.ts` (HP regen), `src/engine/danger.ts` (danger hint).

**A run = a search for an opponent, then a live fight** (engine 1.8.0). The search is a timer; when it ends the fight starts and plays out in engine time, strike by strike, and its outcome applies when it ends. Then the next run's search starts at once.

### Tiers (2026-10-26, engine 1.4.0; rebalanced 2026-10-27, engine 1.8.0)

Five dungeons, one enemy each. All of it is data (`DUNGEONS`, `ENEMIES`); no dungeon has its own code.

| # | id | Name | Enemy (HP · dmg · def · strikes every) | Base search (DEX 10) | Unlock | Win: XP · gold | Loot |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `rat_cellar` | Rat Cellar | Rat 30 · 3–5 · 2 · 1 s | 2:00 (1:50) | — | 35 · 2–5 | Rat Skin 50% |
| 2 | `bat_cave` | Bat Cave | Bat 60 · 6–9 · 6 · 1 s | 3:00 (2:50) | 10 wins in Rat Cellar | 60 · 6–12 | Bat Wing 40% |
| 3 | `wolf_den` | Wolf Den | Wolf 110 · 10–14 · 12 · 1 s | 5:00 (4:50) | 15 wins in Bat Cave | 140 · 15–30 | Wolf Pelt 30% |
| 4 | `forgotten_crypt` | Forgotten Crypt | Skeleton 180 · 15–20 · 20 · 1 s | 8:00 (7:50) | 25 wins in Wolf Den | 300 · 35–60 | Old Bone 25% |
| 5 | `troll_bridge` | Troll Bridge | Troll 300 · 22–30 · 30 · 1 s | 12:00 (11:50) | 40 wins in Crypt | 650 · 80–130 | Troll Hide 20% |

Every tier uses the same search rule (−1 s per DEX, minimum 1:00), skip rule, combat, regen and auto-repeat. Loot items are stackable commons in the item catalog. Each enemy has its own `attackIntervalMs` (all 1000 today).

Reach (1000 fights per cell with the real combat code, full HP; 2026-10-26, before live combat): a hero with base attributes (STR/END 10) beats Bat Cave from Lv 1 and Wolf Den from about Lv 6–7. The Crypt needs about STR/END 20 at Lv 10 (98% wins) and the Troll about STR/END 30 at Lv 20; at STR/END 10 both are 0%. So tiers 4–5 wait for Training (M3), as intended. With every interval at 1 s the fights are the same strike for strike (see "Fight"); regen now also runs during the fight (slightly in the hero's favour) and the cap moved from 50 rounds to 60 s, so this still holds.

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
heroHits = ceil(enemy HP / heroAvg);  fightMs = heroHits × hero attack interval
enemyHits = ceil(fightMs / enemy attack interval) − 1      (enemy strikes landing before the killing blow; ties go to the hero)
expected loss = enemyHits × enemyAvg                       (regen during the fight is ignored)
percent  = loss / max HP:  < 40% Easy · < 100% Tough · otherwise Deadly (also Deadly when fightMs > the 60 s limit)
```

Thresholds live in `DANGER`. It measures the HP a fight costs, not the chance to lose: a fresh hero sees Bat Cave as Tough yet wins it every time. A fresh hero sees Easy, Tough, Deadly, Deadly, Deadly. The UI colors pass 4.5:1 on parchment.

### One activity at a time

`state.activity` is a gathering skill (`{kind: 'woodcutting', treeId}` or `{kind: 'mining', rockId}`), `{kind: 'dungeon', dungeonId, phase, progressMs, fight}` or `{kind: 'training', attribute}` (see "Training"). `START_ACTIVITY` with the other kind stops the running one first. **Stopping a dungeon (STOP_ACTIVITY, or starting another activity) during the search cancels the run: it is lost, with no rewards** (event `DUNGEON_RUN_CANCELLED`). **During the fight it is a forfeit**: the fight ends at once as a loss with end reason `forfeit` and the normal loss rules (hero HP → 0, no rewards, a loss on the counters, `lastFight` recorded with the strikes so far and `durationMs` = time fought; event `FIGHT_RESOLVED`, no `DUNGEON_RUN_CANCELLED`). The UI's Stop button reads "Flee (counts as loss)" during the fight. Runs that already finished before the command are kept, because every command first simulates to `now`. The UI asks before either action.

### Runs (auto-repeat)

```
searchMs = max(minMs, baseMs − perDexterityMs × DEX)  per dungeon (DungeonDef.search): searchMsFor(dungeonId, effectiveAttributes(state))
Rat Cellar: max(60 000, 120 000 − 1 000 × DEX)      DEX 10 → 110 s (1:50)
```

The dungeon activity records its **phase** (save v9):

- `phase: 'search'`: `progressMs` is the time into the search; `fight` is null.
- `phase: 'fight'`: `fight` holds the fight in progress (`ActiveFight`, see "Fight"); `progressMs` is 0.

While the dungeon activity is active, runs follow each other back-to-back, live and offline: when a search's time is up the fight starts, when the fight ends its outcome applies and the next search starts **at once, whatever the HP**. Dungeon time goes through the same `simulate()` and the same time rules as woodcutting: backward clock = pause, invalid time = no-op, and the **8 h offline cap limits the time played**.

**Fight at the offline cap (1.9.0, owner-approved 2026-10-28).** When the cap ends the granted time while a fight is active (phase `fight`), that fight is **finished** with the time beyond the cap: its strikes keep landing at their exact times until it ends, which is at most `COMBAT.maxFightMs`, and never later than the time that really passed (`requestedMs − grantedMs`; with only 0.5 s beyond the cap the fight gets 0.5 s and continues live on the next resume). After it, nothing else progresses: the next search starts and stays at 0 until the next resume. A **search** in progress at the cap still pauses there. This removes the old "come back to a paused fight at full HP" quirk (the regen over the whole absence used to heal the hero mid-fight). The finishing walk is the same event walk (same strikes, same RNG draws, regen at the rate of the moment), so the fight's outcome equals live play and does not depend on how long beyond the cap the absence was (9 h, 20 h and 72 h give the same state; tested). `summary.grantedMs` stays the cap.

### Skip (search only)

`SKIP_DUNGEON_RUN` costs `ceil(remainingMs / 60 000)` stamina (1 per started minute of **search** left, at least 1: 1:50 → 2, 0:30 → 1) and ends the search now: the fight starts at once, at the current HP, and **always plays live** from that moment. **No HP regen for the skipped time** (owner decision, as before). During the fight the skip is refused with **`FIGHT_IN_PROGRESS`** (the UI hides the button). Not enough stamina → `NOT_ENOUGH_STAMINA`, nothing changes (the UI greys the button). No dungeon running → `NO_DUNGEON_RUN`.

The command is bound to what the player saw: `{ run, maxCost }`, where `run` is the run number on screen (`DungeonRunView.run` = lifetime runs + 1) and `maxCost` the cost on the button. If the search on screen already ended by the time the command is applied (time passes between the tap and `now`, and the client simulates first), the skip fails with `FIGHT_IN_PROGRESS` while that run's fight goes on, and with **`RUN_CHANGED`** once the run is over (the next run has a new number); a real cost above `maxCost` is also `RUN_CHANGED`. Nothing is spent in any of these cases, so a skip never charges more than shown and never skips the next run instead. The UI stays quiet on both: the screen already shows the fight or the new search. At 0 HP the skip stays enabled and the UI warns "Certain loss — 0 HP" (the fight is an immediate `no_hp` loss). It is a logged command, replayed like any other. Waiting is always free.

### Current HP and regen

```
regen per minute = 5 + 1 × END (effective)         END 10 → 15/min (1 HP every 4 s)
```

- Flat and continuous: during searches **and fights**, while woodcutting, idle and offline.
- Remainder kept like stamina, in `character.hpRegenProgress`, in "HP·ms per minute" units: each ms adds the rate, 60 000 units = 1 HP. Integer math, exact across resumes (many 1 s ticks = one big resume, tested) and when END changes. At max HP the remainder is 0. A hit or a loss changes `hp` only; the remainder is kept.
- Uses the sanitized time **before** the 8 h cap (`requestedMs`), like stamina: max HP already bounds it. Backward clock or jitter → no regen; invalid time → no-op.
- A fight that starts at 0 HP is an immediate loss with no rolls.

### Event walk (live and offline)

`advanceDungeon()` walks the granted (capped) time **event by event**, in time order. The events are: the end of a search (the fight starts), each strike, the end of a fight (the time limit, or a side at 0 HP).

1. regen HP over the time up to the next event, at the rate of the moment;
2. apply the event: start the fight with the HP at that moment; or land the strike (seeded roll); or end the fight (rewards rolled, counters, `lastFight`) and start the next search at once;
3. repeat until the next event is later than the granted time (the leftover goes into the search's `progressMs` or the fight's `elapsedMs`). Every event due at or before that time happens, so two strikes due at the same instant are never split across calls;
4. if the cap ended the walk inside a fight, keep walking that fight's events with the time beyond the cap until it ends (see above);
5. then regen over the rest of the uncapped time (the part of a long absence beyond the cap only counts for regen).

Live 1 s ticks, 1 ms ticks, a simulate boundary at any point inside a fight, an app killed mid-fight and one big resume all give the same state, byte for byte (tested), because time is split only at events and the RNG is drawn only at strikes and at the fight's end, in time order.

### Fight

```
each side strikes on its own timer from the fight's start: strike n of a side lands at n × its attackIntervalMs
on a tie the hero strikes first; each strike rolls a whole number in [min, max] (seeded RNG)
dealt = max(1, round(roll × K / (defense + K)))       K = 50; 13 defense blocks ~21%
```

- Rounding is integer half-up: `floor((2 × roll × K + (def + K)) / (2 × (def + K)))`. No `Math.pow`; the engine guard test bans it. Damage formula and rolls are the same as before 1.8.0.
- Hero damage, defense and attack interval come from `getDerivedStats`; the enemy's from `ENEMIES`. Both are **frozen when the fight starts** (`ActiveFight.hero` / `.enemy`): gear changed mid-fight counts from the next fight. The hero's **HP is not frozen**: it is `character.hp` throughout, so regen keeps running between strikes and a potion drunk mid-fight counts. No hit chance or crit yet.
- With both intervals at 1 s (everyone today) the order is hero, enemy, hero, enemy… at 1 s, 2 s, 3 s…, which is exactly the old turn order: same rolls, same damage. Only the cap and the timing are new.
- The fight ends when either side reaches 0 HP, or at **`COMBAT.maxFightMs` = 60 s, which is a loss** (`time_limit`). Strikes due at exactly 60 s still land; both alive after them = time limit. Every loss leaves the hero at 0 HP (also a time-limit loss). A hero whose HP was set to 0 mid-fight (debug) loses at the next event.
- The engine writes why it ended into the record: `endReason` = `enemy_defeated` | `hero_defeated` | `time_limit` | `no_hp` | `forfeit` (stopped or switched activity mid-fight, see "One activity at a time"), and `durationMs`. The UI labels it and never recomputes it.
- **Win:** the tier's hero XP (through `addXp`, so multi-level-ups carry over), gold (rolled in the tier's range), then each drop (rolled). Rolls happen in that order at the fight's end. A full inventory loses the item, like woodcutting drops. **Loss:** nothing.
- Example, Rat Cellar: one Rat (HP 30, damage 3–5, defense 2, 1 strike/s). A new hero (12–14 damage, 13 defense, 50 HP, 1 strike/s) kills it with the 3rd strike at 3 s and takes 4–8 damage (the Rat's strikes at 1 s and 2 s, 2–4 each after defense).

**Why the fight is played event by event instead of being rolled up front.** The brief suggested rolling the whole fight when the search ends, storing the timed log and revealing it. That gives the same determinism, but the hero's HP would then live in two places (the pre-rolled log and `character.hp`): regen during the fight would have to be folded into the roll, and anything that changes HP mid-fight (a potion, a debug HP change) would be silently overwritten when the stored result is applied at the end. Playing the strikes at their exact times inside `simulate()` keeps one source of truth for HP, uses the same regen code as everywhere else, stores only the strikes that already landed, and is resumable by construction (the state holds `elapsedMs`, both strike counters and the enemy's HP). Determinism rests on the same rule as before: time is split only at events.

### The fight in progress (save v9)

```
ActiveFight = { enemyId, elapsedMs, heroHpStart, heroMaxHp, enemyHp, enemyMaxHp,
                hero: {damage, defense, attackIntervalMs}, enemy: {…}, heroStrikes, enemyStrikes, log }
next strike of a side = (strikes + 1) × attackIntervalMs;   time limit = COMBAT.maxFightMs
```

`dungeonRunView(state)` gives the UI `phase`, the search countdown (`remainingMs`, `fraction`, `skipCost`, null during the fight) and, during the fight, `fight: {enemyHp, heroHp (live), maxes, elapsedMs, maxFightMs, log}`. The dungeon modal shows "Searching for opponent…" with the countdown, then the live fight (hero and enemy HP bars, the last 8 strikes, elapsed / 1:00). Strikes appear when engine time reaches them: the client ticks once a second and the screen only reads the state, so closing the modal or the app changes nothing. The activity strip shows the enemy's HP during the fight.

### Stored log policy

The engine produces the fight log (`{atMs, actor, strike, roll, dealt, targetHpAfter}` per strike) and the UI shows or replays it. To keep saves small, only **the fight in progress** (its strikes so far, at most 2 × 60 with 1 s intervals) and **the last finished fight** are stored (`state.dungeon.lastFight`), plus lifetime counters: `state.dungeon.totals = {runs, wins, losses}` over all dungeons and `state.dungeon.byDungeon[id]` per dungeon. No per-run log is kept; an offline catch-up of 250 runs keeps only the last. The "While you were away" summary carries the totals for the period (runs, wins, losses, hero XP, gold, loot).

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
| 1 | `oak` | Oak | 1 | 20 | 2:00 | 1:50 | 25 | `oak_logs` |
| 2 | `birch` | Birch | 5 | 100 | 5:00 | 4:50 | 119 | `birch_logs` |
| 3 | `maple` | Maple | 15 | 450 | 10:00 | 9:50 | 369 | `maple_logs` |
| 4 | `yew` | Yew | 28 | 905 | 18:00 | 17:50 | 853 | `yew_logs` |
| 5 | `ironwood` | Ironwood | 42 | 1395 | 30:00 | 29:50 | 1672 | `ironwood_logs` |

```
required WS    = max(20, 35 × reqLevel − 75)           (Oak: 20 since 1.10.0; was 0)
XP per cut     = round(12.5 × base minutes × reqLevel^0.4)
cut time       = max(10 s, base − 1 s × effective DEX)
logs per cut   = WS ÷ required WS × yield multiplier    (see "Gathering yield")
```

Required WS and XP per cut are **stored precomputed** in `TREES` (the engine bans `Math.pow`); `tests/woodcutting.test.ts` asserts both formulas against the stored values. Every cut also rolls the **Bird Nest at 1/200** (seeded RNG, one roll per cut whatever the yield), on every tree. Log items are stackable commons. Woodcutting XP is per cut, not per log.

### Rules

- `START_ACTIVITY {kind:'woodcutting', treeId}`. While the Woodcutting building is locked it fails with **`BUILDING_LOCKED`** (1.9.0, see "Buildings"). A tree whose level **or** WS requirement isn't met fails with **`TREE_LOCKED`** (message says what is missing); an unknown or missing tree with `UNKNOWN_TREE`. The same tree again keeps the log in progress; another tree starts a new log from 0.
- Logs are cut back-to-back while active, live and offline, in the same `simulate()` with the same clock rules (8 h cap, backward = pause, invalid = no-op). Cut time depends on DEX only, which woodcutting never changes, so many small ticks equal one big resume (tested).
- One activity at a time: starting woodcutting stops training (XP kept) or cancels a dungeon run (lost; the UI asks first). Starting either of them stops woodcutting (logs kept).
- **Skip:** `SKIP_WOODCUT {log, maxCost}` costs `ceil(remaining min)` stamina (at least 1) and completes exactly the current log; the next log starts from 0. `log` is the log number on screen (`stats.totalActions + 1`, lifetime logs + 1). If that log already finished, or the real cost is higher than `maxCost`, it fails with **`LOG_CHANGED`** and nothing is spent (same guard as the dungeon skip). Other errors: `NOT_WOODCUTTING`, `NOT_ENOUGH_STAMINA`, `INVALID_AMOUNT`.
- Woodcutting level, XP and logs from before 1.6.0 are kept.
- Views: `woodcuttingView(state)` (level, XP, WS + breakdown, one `TreeView` per tree with ✓/✗ per requirement, the active tree, `focusTreeId` = active tree else the highest unlocked one, and the log in progress), `woodcutActivityView(state)` (tree, cut time, fraction, remaining, log number, skip cost).

## Mining (Mine Shaft)

Data: `src/engine/config/mining.ts` (`MINING`, `ROCKS`). Rules: `src/engine/mining.ts`. Owner-approved 2026-10-28, engine 1.9.0, save v10. Mining **mirrors woodcutting rule for rule**, but every number lives in its own config and nothing is shared with `config/woodcutting.ts`, so the two skills can get different bonuses later (tested). It uses the `mining` skill, which every save already had (the v10 migration adds it at Lv1 when missing). The Mine Shaft must be built first (see "Buildings").

```
MS (mining strength) = 10 × mining level + effective STR + pickaxe bonus (catalog `miningStrength`)
required MS          = max(20, 35 × reqLevel − 75)                (stored precomputed; Stone 20 since 1.10.0)
ores per action      = MS ÷ required MS × yield multiplier        (see "Gathering yield")
XP per ore           = round(12.5 × base minutes × reqLevel^0.4)  (stored precomputed)
time / ore           = max(10 s, base − 1 s × effective DEX)
```

| # | id | Rock | Req. level | Req. MS | Base time / ore | At DEX 10 | XP / ore | Ore item (sell) |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `stone` | Stone | 1 | 20 | 2:00 | 1:50 | 25 | `stone` (1) |
| 2 | `copper` | Copper | 5 | 100 | 5:00 | 4:50 | 119 | `copper_ore` (3) |
| 3 | `iron` | Iron | 15 | 450 | 10:00 | 9:50 | 369 | `iron_ore` (8) |
| 4 | `silver` | Silver | 28 | 905 | 18:00 | 17:50 | 853 | `silver_ore` (20) |
| 5 | `gold` | Gold | 42 | 1395 | 30:00 | 29:50 | 1672 | `gold_ore` (50) |

- New **`pickaxe`** equipment slot: new saves start with the **Wooden Pickaxe** (+1 MS), so a new hero has MS 21. The **Iron Pickaxe** (+40 MS, buy 600, sell 180) is in the merchant stock right after the Iron Axe.
- Every mining action rolls the **Geode** at 1/200 (uncommon, sell 30), seeded RNG, once per action whatever the yield.
- `START_ACTIVITY {kind:'mining', rockId}`: `BUILDING_LOCKED` (Mine Shaft not built), `UNKNOWN_ROCK`, `ROCK_LOCKED` (level or MS missing; the message says what). Same rock again keeps the ore in progress; another rock starts from 0. One activity at a time, like every activity.
- Ores are mined back-to-back live and offline, same `simulate()` and clock rules (8 h cap, backward = pause). Many small ticks equal one big resume (tested).
- **Skip:** `SKIP_MINE {ore, maxCost}`: `ceil(remaining min)` stamina (at least 1) completes exactly the current ore. `ore` = `MineActivityView.ore` (lifetime gathering actions + 1; `stats.totalActions` counts logs and ores). Already finished or a higher real cost → **`ORE_CHANGED`**; also `NOT_MINING`, `NOT_ENOUGH_STAMINA`, `INVALID_AMOUNT`.
- **Stop rule:** an equip / unequip that drops MS below the current rock's requirement stops mining (finished ores kept). Pickaxe changes never touch woodcutting and axe changes never touch mining.
- Summary: `SimulationSummary.oresMined` (separate from `actions`, which stays "logs cut"), ores under `itemsGained`, `skillXpGained.mining`. Ores mined count as progress for "While you were away".
- Views: `miningView(state)` (level, XP, MS + breakdown, one `RockView` per rock, `focusRockId`, the ore in progress), `mineActivityView(state)` (rock, time per ore, fraction, remaining, ore number, skip cost). `activityView()` returns it with `kind: 'mining'`.
- Debug: `DEBUG_ADD_MINING_LEVEL {levels}` (1–100 per command, level at most 1,000, XP kept).

## Gathering yield (1.10.0)

Rules: `src/engine/gathering.ts` (shared math), used by woodcutting, mining and the worker crews; each skill keeps its own config. Owner-approved 2026-10-28.

```
yield (basis points) = floor(power × multiplierBp ÷ requirement)        10 000 bp = 1 item
items per action     = whole part + 1 more when a roll in [0, 9 999] < fraction part   (rollYield: one seeded draw, always)
```

- Hero power = WS / MS as before (10 × skill level + effective STR + axe / pickaxe). Example: WS 30 on Oak (20) = 15 000 bp = 1 log + 50% chance of a second.
- The requirement is the divisor, so no node has a requirement of 0 any more (Oak and Stone: 20; the others keep 100 / 450 / 905 / 1395). Below the requirement the node can't be worked (unchanged gate).
- Integer math only: the fraction is compared with a whole roll, so no float decides an outcome (`Math.pow` and friends stay banned).
- Skill XP stays **per action**, the rare drop (nest / geode) is **one roll per action**, action time is unchanged (DEX). The roll order per action: yield, then the rare drop. A stamina skip of one log / ore also rolls the yield.
- `multiplierBp` = `yieldMultiplierBp(state, skill)` (see "Building bonuses"); 10 000 with no bonus.
- Views: `TreeView.yieldBp` / `RockView.yieldBp` (expected items per action for this hero right now).

## Buildings

Data: `src/engine/config/buildings.ts` (`BUILDINGS`, `BUILDING_IDS`, `TOWN_HALL_UPGRADES`, `BUILDING_UPGRADES`, per-level bonuses). Rules: `src/engine/buildings.ts`, `src/engine/bonuses.ts`. Owner-approved 2026-10-28, engine 1.9.0, save v10; upgrades, the builder and bonuses in engine 1.10.0, save v11.

`state.buildings = { woodcutting, mine_shaft, town_hall, training_grounds, merchant, crafting }` (`crafting` since save v13), each `{ state: 'locked' | 'built', level }` (level 0 while locked, 1 once built, up to 5 with upgrades). The Merchant is a stored building since save v11 (`startsBuilt`: built at Lv1 on every save, `BUILD` answers `ALREADY_BUILT`). Dungeon and Storage are always there and are not stored (not upgradable). A new save has the four others locked.

| Building | Requirements (data) | Unlocks |
| --- | --- | --- |
| Woodcutting | 50 gold | `START_ACTIVITY` woodcutting |
| Mine Shaft | 50 gold | `START_ACTIVITY` mining |
| Town Hall | hero Lv5, 20 Oak Logs, 20 Stone, 100 gold | the Town Hall modal: upgrades and workers (1.10.0) |
| Crafting (1.13.0) | Woodcutting and Mine Shaft built, 30 Oak Logs, 30 Stone, 150 gold | `START_CRAFT` (the pipes) |
| Training Grounds | hero Lv10, Town Hall Lv1, 50 Oak Logs, 50 Stone, 250 gold | `START_ACTIVITY` training and `UNLOCK_TRAINING_TIER`; training XP per minute by level (1.11.0); **comes with Tier 1** (`grantsTrainingTier`), so Tier 1 costs no extra 100 gold; Tier 2+ is paid as before (a hero already above Tier 1 keeps his tier) |

- **`BUILD {buildingId}`**: checks **every** requirement first, then consumes the items (from the inventory stacks) and the gold and builds at once (level 1, event `BUILDING_BUILT`; the Training Grounds also emit `TRAINING_TIER_UNLOCKED` when they raise the tier). Errors change nothing: `ALREADY_BUILT` (so a double tap never pays twice), `REQUIREMENTS_NOT_MET` (the message lists what is missing), `UNKNOWN_BUILDING` (also for Dungeon / Merchant / Storage). It is a logged command, replayed like any other, and not an activity.
- **`BUILDING_LOCKED`**: `START_ACTIVITY` for woodcutting, mining and training, and `UNLOCK_TRAINING_TIER`, refuse while their building is locked. The lock is checked before anything else.
- **`DEBUG_BUILD {buildingId}`**: builds for free, ignoring the requirements (effects still apply), sets `debugUsed`. The Build sheet shows it as "Build free (debug)".
- View: `buildingView(state, id)` → name, icon, description, built, level, `requirements` (each `{kind, need, have, met}` in the order hero level, buildings, items, gold), `canBuild`, `grantsTrainingTier`, `upgrade` (below). `isBuilt(state, id)`, `buildingLevel(state, id)`.

### Upgrades and the builder (1.10.0)

| To level | Town Hall (`TOWN_HALL_UPGRADES`) | Every other building (`BUILDING_UPGRADES`: half, rounded up) |
| ---: | --- | --- |
| 2 | 500 g, 50 Oak Logs, 50 Stone, 30 min | 250 g, 25 Oak Logs, 25 Stone, 15 min |
| 3 | 2,000 g, 100 Birch Logs, 100 Copper Ore, 2 h | 1,000 g, 50 Birch Logs, 50 Copper Ore, 1 h |
| 4 | 8,000 g, 200 Maple Logs, 200 Iron Ore, 8 h | 4,000 g, 100 Maple Logs, 100 Iron Ore, 4 h |
| 5 | 32,000 g, 400 Yew Logs, 400 Silver Ore, 24 h | 16,000 g, 200 Yew Logs, 200 Silver Ore, 12 h |

- `state.construction = { buildingId, level, durationMs, progressMs, startedAt } | null`: the **one builder**'s job (`durationMs` fixed when it starts, so a config change never alters a job in progress).
- **`UPGRADE_BUILDING {buildingId, level}`**: `level` is the target the player saw (current + 1). Checks, in order, before anything is paid: `UNKNOWN_BUILDING`, `BUILDING_LOCKED`, `MAX_LEVEL` (5), `NOT_UPGRADABLE` (the next level has no bonus data, `hasLevelBonuses`; no building since 1.11.0, when the Training Grounds got theirs), `LEVEL_CHANGED` (not current + 1: a double tap never pays twice), `TOWN_HALL_TOO_LOW` (every building but the Town Hall stays ≤ the Town Hall's level), `BUILDER_BUSY` (one construction at a time), `REQUIREMENTS_NOT_MET` (gold and items, the message lists what is missing). Then gold and items are consumed **atomically** and the builder starts (event `CONSTRUCTION_STARTED`). No cancel.
- The job progresses in `simulate()` on the **granted (capped)** time, in the world walk (below), and completes when `progressMs ≥ durationMs`: the level rises, event `BUILDING_UPGRADED`, `SimulationSummary.buildingsUpgraded`, and `onUpgraded()` applies stored effects (the Merchant's new stock slots). It never blocks or touches the hero's activity.
- **`DEBUG_FINISH_CONSTRUCTION`**: completes the job now, sets `debugUsed`; `NO_CONSTRUCTION` when the builder is idle. The Upgrade sheet shows it as "Finish now (debug)".
- Views: `upgradeView(state, id)` → level, max, next level, cost lines (have / need / met), builder time, `block` (`locked` | `max_level` | `not_upgradable` | `town_hall` | `builder_busy` | `cost` | null), `townHallNeeded`, `upgrading`, current and next-level `bonuses`. `constructionView(state)` → the job with `remainingMs` and `fraction` (the Village sign shows "Upgrading 12:34"; with no activity the activity strip shows it).

### Building bonuses (1.10.0)

Data per building **level** (`BuildingDef.levels[level − 1]`, totals for that level, not increments): `yieldBp` per skill, `sellPriceBp`, `workerCap`, `stockSlots`, `trainingXpPerMin` (1.11.0), `craftTimeBp` and `craftYieldBp` (1.13.0). A locked building gives nothing. Bonuses from different buildings **add**:

```
yield multiplier = 10 000 + Σ yieldBp[skill]          (hero and workers; bonuses.ts yieldMultiplierBp)
sell price       = floor(sellPrice × (10 000 + Σ sellPriceBp) / 10 000)
worker cap       = the Town Hall level's workerCap (0 while locked)
stock slots      = the Merchant level's stockSlots
training XP/min  = the Training Grounds level's trainingXpPerMin (bonuses.ts trainingXpPerMinute; 1 when none)
craft time       = the Crafting level's craftTimeBp (10 000 when none), × INT's reduction (crafting.ts)
crafted yield    = the Crafting level's craftYieldBp (normal items only)
```

| Building | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 |
| --- | --- | --- | --- | --- | --- |
| Town Hall | cap 5 | +2000 bp wood & mining yield, +2000 bp sell, cap 7 | same, cap 9 | same, cap 12 | same, cap 15 |
| Woodcutting | — | +2000 bp woodcutting | +4000 | +6000 | +8000 |
| Mine Shaft | — | +2000 bp mining | +4000 | +6000 | +8000 |
| Merchant | 5 slots | 7 | 9 | 11 | 13 |
| Training Grounds | 1 training XP/min | 2 | 3 | 4 | 5 |
| Crafting | craftTimeBp 10 000 | 9 000 | 8 100 | 7 290, craftYieldBp 1 000 | 6 561, craftYieldBp 2 000 |

The building modals show the current level's lines under the header (`currentBonusLine`, `bonusText.ts`: "Lv3 · −19% craft time", "Lv1 · no bonus yet").

## The world walk (1.10.0)

Rules: `src/engine/world.ts`. `simulate()` runs the hero's activity side by side with the village's own timers (the builder, the worker crews and, since 1.13.0, the crafting pipes) over the **granted** time.

- With no construction and no crew, the walk is one step: exactly the hero's activity over the whole granted time (the 1.9.0 path).
- Otherwise the granted time is cut into **steps** ending at the next village event: the upgrade completing, a crew action completing, the paid upkeep minute running out, a craft finishing in a running pipe, and, while a crew is idle or the workforce is paused, the hero's next event (it can make a node workable again or bring dungeon gold). Inside a step nothing in the village changes, so the hero's activity advances by the step; every activity is already split-invariant, so cutting it at extra points changes nothing.
- **Order at one instant:** (1) the hero's events due then (a log, a strike, a fight ending with its gold, a training level); (2) the upgrade completing (its bonus counts for the crews and pipes right after); (3) the crews' actions due then, in `WORKER_NODE_IDS` order (trees, then rocks), each drawing its yield roll; (4) the pipes' crafts due then, in pipe order (1.13.0): each delivers its output (or holds the pipe while it does not fit) and the next craft starts with a duration read right then, so a house upgrade or an INT training level at that instant counts; (5) at the start of the next step, `settleWorkers()`: idle flags follow the hero, and the next minute of upkeep is charged (or the crews pause / resume); then `settleCrafting()`: held pipes deliver if their output fits now. So dungeon gold earned at a minute boundary counts before that minute is charged.
- HP regen: dungeon and training steps regenerate HP inside their own walk; gathering and no activity regenerate once at the end. Beyond the cap only a dungeon fight in progress is finished (and HP regenerates); the village does not move.
- Many small simulate calls equal one big one, byte for byte, with crews, upkeep, pauses and the builder (tested with 1 s ticks, 7 s and 13 s splits, dungeon gold resuming paused crews and a level-up resuming an idle crew).

## Workers (1.10.0)

Data: `src/engine/config/workers.ts` (`WORKERS`); the cap per Town Hall level is a building bonus. Rules: `src/engine/workers.ts`. Owner-approved 2026-10-28.

```
state.workers = { list: [{id: 'w<n>', node: TreeId | RockId | null}], nextSerial, crews: {[node]: {progressMs, workMs, idle}},
                  paused, minuteLeftMs, paidPerMin }
hire cost      = 100 × 2^(workers owned)                     (doubling loop, no Math.pow)
crew power     = hero power × 25% × average workers over the action     (average = workMs ÷ base time)
crew yield     = crew power ÷ node requirement × yield multiplier       (integer bp, staged far below 2^53)
action time    = the node's base time (no DEX)
upkeep         = Σ working workers × tier upkeep (1 / 5 / 15 / 40 / 100 gold per minute, tier 1 = Oak / Stone)
```

| Command | Effect | Errors (nothing changes) |
| --- | --- | --- |
| `HIRE_WORKER {maxCost}` | pays the hire cost, adds an unassigned worker (event `WORKER_HIRED`). `maxCost` is the price shown | `BUILDING_LOCKED` (no Town Hall), `WORKER_CAP`, `COST_CHANGED`, `NOT_ENOUGH_GOLD`, `INVALID_AMOUNT` |
| `DISMISS_WORKER {workerId}` | removes the worker, no refund | `UNKNOWN_WORKER` |
| `ASSIGN_WORKER {workerId, node}` | puts the worker on a tree or rock **the hero can work now** (skill level and power at the requirement) whose building is built; same node = no-op; another node moves it | `UNKNOWN_WORKER`, `UNKNOWN_NODE`, `BUILDING_LOCKED`, `NODE_LOCKED` |
| `UNASSIGN_WORKER {workerId}` | back to unassigned (free); already unassigned = no-op | `UNKNOWN_WORKER` |

- **Crews.** All workers on a node form its crew; it works on its own timer, independent of the hero's activity, live and offline, on the granted time. The hero working the same node is separate and additive (own timer, own yield). Workers give **no XP** and **no rare drops**. Output goes to the inventory; what doesn't fit is lost (`workerItemsLost`). Crew power reads the hero's **current** power, so better gear counts at once.
- **Average crew size.** `workMs` adds worker·ms while the crew works; at completion the yield uses `workMs ÷ base time` workers (= n when the crew did not change). A crew keeps its progress when workers join or leave, and goes away (progress dropped) with its last worker. So moving workers onto a node just before its action ends gains nothing.
- **Idle.** When the hero no longer qualifies for a node (an equip change), its crew goes idle: still assigned, no work, no upkeep (event `CREW_IDLE`); it resumes when he qualifies again (`CREW_ACTIVE`), also mid-simulate after a level-up. Hero power never drops inside simulate.
- **Upkeep.** Charged per started minute: when the paid minute runs out (or when work starts) the next minute is paid in full for every working worker; a rise mid-minute (a worker joining, a crew resuming) pays the difference at once; a fall is not refunded. If gold can't cover what is due, **every** crew pauses (`WORKERS_PAUSED`, nothing charged, `workers.paused`), and resumes as soon as gold covers it (`WORKERS_RESUMED`): at the next world-walk step (dungeon gold) or at the end of any command (a sale). Gold never goes negative. Idle and unassigned workers cost nothing.
- **After every command** `settleWorkers()` runs once, so the workforce follows equip changes, sales and assignments at once.
- Summary: `workerActions`, `workerItemsGained`, `workerItemsLost`, `upkeepPaid` (shown in "While you were away").
- Views: `workersView(state)` (hired / cap, hire cost, paused, upkeep per minute, each worker's status, crews), `crewViews(state, skill?)` (per node: workers, status, expected yield and items per minute, upkeep), `nodeChoices(state)` (the picker: tier, upkeep per worker, items per minute for one more worker, available / why not).

## Crafting (1.13.0; gear 1.14.0)

Data: `src/engine/config/crafting.ts` (`CRAFTING`, `RECIPES`, `RECIPE_IDS`, `CRAFT_MODES`), the house's bonuses in `config/buildings.ts`, INT's curve in `config/stats.ts`. Rules: `src/engine/crafting.ts`. Owner-approved 2026-11-01, save v13.

```
state.crafting = { pipesUnlocked (2..8), pipes: [CraftJob | null] × 8, remainders: {itemId: thousandths}, nextJobSerial }
CraftJob       = { id, recipeId, mode: 'x1' | 'x10', quantity, done, craftMs, progressMs, staminaPerCraft,
                   status: 'running' | 'held' | 'ready', startedAt, gear?: { staminaInvested, qualityBp, rarity } }
craft ms       = max(1 000, ceil(baseMs × houseTimeBp × (10 000 − intBp) ÷ 10^8))     (integer; ≤ 8e12 before the division)
intBp          = diminishingBp(effective INT, 5 000, 50)
x10 stamina    = max(1, ceil(9 × craft ms ÷ 60 000)) per craft, the whole job paid at start
insta          = max(1, ceil(remaining ms ÷ 60 000)) stamina
output (milli) = floor(units × (10 000 + yieldBp) ÷ 10)    units = output × (1 | 10); yieldBp only for `material` recipes
```

- **Not an activity.** Pipes never use the hero, never stop or get stopped by gathering, dungeons or training, and run in parallel. They progress in the **world walk** on the granted (capped) time (`advancePipes`, `pipesNextEventMs`, `anyPipeRunning` makes the village busy), live and offline: 8 h cap, a backward clock pauses them, garbage time is a no-op. Split-invariant (tested with 1 s, 7 s and 13 s splits against one simulate, with a crew, woodcutting, an x10 job and a house upgrade completing mid-job).
- **A job** = recipe × quantity (1..100 000) × mode. `START_CRAFT {pipe, recipeId, quantity, mode, maxCost}` checks, in order, `BUILDING_LOCKED`, the pipe index (`INVALID_COMMAND`), `PIPE_LOCKED` (index ≥ `pipesUnlocked`), `PIPE_BUSY`, `UNKNOWN_RECIPE`, the mode (`INVALID_COMMAND`), `INVALID_AMOUNT` (quantity, maxCost), `NOT_ENOUGH_ITEMS` (the whole job's inputs), `COST_CHANGED` (x10 stamina above `maxCost`, the cost shown; 0 for x1), `NOT_ENOUGH_STAMINA`; then consumes every input and the stamina **atomically** (`CRAFT_STARTED`). Pipes never compete for materials.
- **Crafts run back to back.** Each craft's `craftMs` is computed when that craft starts (house level and effective INT at that moment); the first at job start. When `progressMs` reaches it, the output goes to the inventory (`CRAFT_COMPLETED`, summary `craftsCompleted` / `itemsCrafted`); the last craft frees the pipe (`CRAFT_JOB_DONE`).
- **Inventory full.** When the output has no stack and no free slot, the pipe is **held** (`status: 'held'`, `CRAFT_HELD`): the timer stays at `craftMs`, nothing is lost. Held pipes retry at the start of every walk step and after every command (`settleCrafting`, after `settleWorkers`), so a sale or a build that frees a slot delivers at once and the next craft starts then.
- **Fraction ledger.** The yield bonus makes fractional output: the whole part is delivered, the rest (thousandths) goes to `crafting.remainders[itemId]`; when it reaches 1 000 one more item is delivered and the rest is kept. No RNG; the inventory stays integer. Lv5 (+20%): 10 crafts of 1 → 12.
- **`INSTA_CRAFT {pipe, jobId, craft, maxCost}`**: bound to the job and craft number shown (`CRAFT_CHANGED`), `COST_CHANGED` above `maxCost`, `NOT_ENOUGH_STAMINA`, `NO_CRAFT_JOB`. Refused with `INVENTORY_FULL` (no stamina spent) when the output would not fit, and while the pipe is held. Finishes the craft now (yield and ledger as usual) and starts the next one.
- **`CANCEL_CRAFT {pipe, jobId}`**: bound to the job shown (`CRAFT_CHANGED`, `NO_CRAFT_JOB`). Refunds the inputs of every craft **not delivered** (`quantity − done`, the one in progress and a held one included) and the stamina of every x10 craft **not started** (`staminaPerCraft × (quantity − done − 1)`), the stamina **capped at max** (no banking above the bar). Refused with `INVENTORY_FULL` when a refunded input would need a slot that isn't free.
- **`DEBUG_UNLOCK_PIPE`**: `pipesUnlocked + 1` (max 8, `PIPES_MAXED`), sets `debugUsed`.
- Views: `craftingView(state)` (house time / yield / INT bp, 8 `PipeView`s with slot `open` / `later` / `premium` and the job view, recipe views with `kind`, have / need, effective time, x10 stamina, Max per mode and, for gear, `gear` = max stats, rarity odds, stamina rule; `ready` count), `craftJobView(state, pipe)` (remaining, fraction, job time left, insta cost, cancel refund, `ready`, `staminaInvested`; **never the roll**), `craftingSign(state)` (the Village sign line, `readyName`), `maxCrafts`, `craftStaminaCost`, `gearQualityFloorBp`, `collectedItemId`.

### Gear crafting (1.14.0)

30 recipes `<set>_<piece>`, kind `gear` (the Equipment tab). Tier n uses tier n's bar and plank; the iron set outputs the existing `iron_*` items.

| Tier | Set | Inputs | Sword dmg | Helm | Chestplate | Shield | Gloves / Boots |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | Stone | Stone Brick + Oak Plank | 4–6 | 2 | 3 | 3 | 1 |
| 2 | Copper | Copper Ingot + Birch Plank | 7–10 | 4 | 6 | 5 | 2 |
| 3 | Iron | Iron Ingot + Maple Plank | 10–14 | 6 | 10 | 8 | 3 |
| 4 | Silver | Silver Ingot + Yew Plank | 16–22 | 10 | 16 | 13 | 5 |
| 5 | Gold | Gold Ingot + Ironwood Plank | 24–34 | 15 | 24 | 20 | 8 |

Inputs per piece (every tier): Sword 4 + 2 (T1 5 min), Helm 3 + 1 (4 min), Chestplate 6 + 2 (8 min), Shield 3 + 3 (5 min), Gloves / Boots 2 + 1 (2 min); times double each tier, then the house × INT rule (1 s floor). Not sold by the Merchant; sellPrice = max(1, floor(25% × inputs' sell value)) at 25% quality (the iron items keep theirs). No yield bonus, no x10.

- **`START_CRAFT {…, quantity: 1, mode: 'x1', stamina, maxCost: stamina}`**: `stamina` 0..50 (`INVALID_AMOUNT`; materials refuse any), x10 (`INVALID_COMMAND`) and quantity ≠ 1 (`INVALID_AMOUNT`) refused. Inputs and the invested stamina are paid at once, never refunded. Then two **main-RNG** draws: `qualityBp = uniform integer in [floor, 10 000]`, floor = min(10 000, 100 × stamina + `minQualityBp(state)` (= `GEAR.craft.minQualityBp`, 0)); then rarity from the recipe's `rarityWeights` or the default uncommon 75 / rare 20 / epic 5. Stored as `job.gear`; stamina never changes the rarity odds (tested: same seed, same rarity at 0 and 50).
- **Ready.** When the craft finishes the job turns `ready` (`CRAFT_READY`, summary `craftsReady[defId]`): progress stays at `craftMs`, the pipe starts nothing else, live and offline. `settleCrafting` never touches a ready pipe.
- **`COLLECT_CRAFT {pipe, jobId}`** (Done): `NO_CRAFT_JOB`, `CRAFT_CHANGED`, `CRAFT_NOT_READY` (still crafting), `INVENTORY_FULL` (no free slot; the piece stays in the pipe). Puts `makeItem(defId, 1, '<defId>#<nextItemSerial>', roll)` in the inventory, frees the pipe (`CRAFT_COLLECTED`). The UI computes the id with `collectedItemId(state, defId)` to open the reveal popover.
- **Insta** on a gear craft: the same cost rule; takes the job to `ready` (no room needed). Refused on a ready job (`CRAFT_READY`).
- **Cancel** while crafting: refunds the inputs (`staminaPerCraft` is 0, so no stamina back; the invested stamina is lost). On a ready job: refused (`CRAFT_READY`) so the inputs can never be refunded while the rolled piece is dropped.
- Split-invariant (the roll is fixed at start; tested across simulate boundaries, a command mid-craft and offline).

## Training

Data: `src/engine/config/training.ts` (`TRAINING`). Rules: `src/engine/training.ts`; effective attributes: `src/engine/attributes.ts`. Owner-approved 2026-10-26, engine 1.5.0, save v6.

The player spends **gold** to unlock training tiers and **time** to raise STR, DEX, END and INT, one attribute at a time. It is the first gold sink, and the way to make dungeon tiers 4–5 beatable.

### Model

```
state.training = { tier: 0..10, attributes: { strength: { level, xp, progressMs }, dexterity: …, endurance: …, intelligence: … } }
effective attribute = character.attributes[k] (base: 10 + debug points) + training.attributes[k].level
```

- **Effective attributes feed every rule**: damage (STR), defense and HP regen (END), dungeon search time and skip cost (DEX). `getDerivedStats`, `hpRegenPerMinute`, `hpView` and `dangerHint` take the `training` slice (required in `StatsInput`, so it can't be left out), and `searchMsFor` is always called with `effectiveAttributes(state)`. The stored attribute stays the base value.
- **Training XP per minute = the Training Grounds level** (1.11.0: Lv1 = 1 … Lv5 = 5, `trainingXpPerMin` in the building's level data) × `TRAINING.rateMultiplier`. `trained ms = granted ms × offline.efficiency × XP per minute` (60 000 trained ms = 1 XP). `TRAINING.rateMultiplier` (1) is the hook for a later effect (e.g. INT) and does nothing today. Every factor must stay a whole number: a fractional rate would need integer progress units, like HP regen. The remainder toward the next XP point is kept in `progressMs`, so no partial minute is lost between resumes.
- **The rate is read when the XP is credited.** The world walk splits the granted time at an upgrade's completion (see "The world walk"), so time before it trains at the old rate and time after it at the new one, whatever the simulate() splits (tested with 1 s ticks, 7 s / 13 s splits and crews). Above 1 XP/min a level is reached `ceil(ms left ÷ rate)` wall ms in, which can train up to rate − 1 ms past the level: that overflow is carried into the next level (dropped only at the tier cap), and it is the same for any split.
- **XP to reach training level n: `5 + 10 × (n − 1)`**, integer math. Level 1 = 5 min, level 20 = 195 min, level 200 = 1,995 min. From level 0: +10 levels = 500 min, +20 levels = 2,000 min, all 200 levels = 200,000 min.
- **Tiers:** 10. Tier t allows training levels up to **20 × t** (200 in total). The tier is **global** (all four attributes). A new hero is at **tier 0: nothing is trainable**. Since 1.9.0 the Training Grounds must be built first, and building them grants Tier 1 (see "Buildings"); Tier 2+ is bought as below.
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
| `UNLOCK_TRAINING_TIER {tier}` | `tier` must be current + 1 (bound to what the player saw: a double tap never buys two). Pays the price; gold stays a whole number ≥ 0. Event `TRAINING_TIER_UNLOCKED`. | `BUILDING_LOCKED` (Training Grounds not built, 1.9.0), `TIER_NOT_NEXT`, `MAX_TIER`, `NOT_ENOUGH_GOLD` (message says how much is missing), `INVALID_COMMAND` |
| `START_ACTIVITY {kind:'training', attribute}` | Same attribute again = no-op. Another attribute switches to it; every attribute keeps its XP. Stops any other activity first (a dungeon run in progress is lost). | `BUILDING_LOCKED` (Training Grounds not built, 1.9.0), `TRAINING_LOCKED` (tier 0), `TRAINING_MAXED` (at the tier cap), `UNKNOWN_ATTRIBUTE` |
| `STOP_ACTIVITY` | Pauses training. Trained XP is always kept (pauses, switches, sessions). | `NO_ACTIVE_ACTIVITY` |
| `SPEEDUP_TRAINING {minutes, maxCost}` (1.6.0; rate in 1.11.0) | Spends **1 stamina per minute** and adds `minutes × 60 000 ms × XP per minute` of training progress (one minute at the current rate) to the attribute being trained right away, through the normal level-up path (several level-ups, auto-stop at the cap). Minutes are **clamped** to `ceil(trained time left to the tier cap / one minute's trained time)` and only those are charged. `maxCost` is the cost the button showed. The Training modal shows +1 min, +10 min and "To next level" (`ceil(XP left ÷ XP per minute)`) on the active row. Numbers: `TRAINING.speedup`. | `NOT_TRAINING`, `NOT_ENOUGH_STAMINA`, `INVALID_AMOUNT`, `COST_CHANGED`, `TRAINING_MAXED` |

### Time, cap and events

- Training is an activity, so **one activity at a time**: starting it stops woodcutting or cancels the dungeon run in progress; starting woodcutting or a dungeon stops training, and its XP is kept.
- It runs inside the same `simulate()` with the same clock rules as woodcutting: the **8 h offline cap** limits training time, a **backward clock pauses** it until real time catches up, invalid time is a no-op.
- `advanceTraining()` walks the granted time **level by level**: HP regenerates at the rate of the moment, and a level-up applies at its exact instant (an END level raises HP regen from then on). So many 1 s ticks and one big resume give the same state, byte for byte (tested). Regen then continues over the rest of the uncapped time, like dungeon runs.
- **Cap:** when the attribute reaches its tier's cap (20 × tier), training **stops by itself**: XP and `progressMs` are set to 0 (no XP beyond the cap, the remainder is dropped), the activity becomes null, and the engine emits `TRAINING_MAXED {attribute}` and `ACTIVITY_STOPPED`. Buying the next tier lets the player train it again (they press Train; it does not resume by itself).
- `TRAINING_LEVEL_UP {attribute, level}` is emitted for **each** level, also when several come in one `simulate()` call (8 h from level 0 = 9 level-ups).
- `SimulationSummary` gains `trainingXpGained`, `trainingLevelsGained` (per attribute) and `trainingMaxed` (attributes that hit the cap). Training XP or a cap counts as progress for "While you were away".
- No RNG; integer math only. The engine guard test still bans `Math.pow`, `**` and `Math.random`.

### UI selectors

`trainingView(state)` → tier, cap, next tier (price, affordable, missing gold), the active attribute, `xpPerMinute` (1.11.0), and per attribute (also `xpPerMinute`): base, trained, effective, cap, XP / XP to next, fraction (remainder included), time to the next level at the current rate, maxed, active. `activityView()` returns the same per-attribute view with `kind: 'training'` for the activity strip.

## Storage: SQLite as a document store

**Decision.** The owner prefers a MongoDB-style model because player attributes will keep growing. No MongoDB/Realm option runs in Expo Go (Realm and Atlas Device Sync are end-of-life), so we use **expo-sqlite** (bundled in Expo Go) as a document store:

- Aggregates are JSON documents in `documents(collection, id, doc, doc_version, updated_at)`. Adding a field to `GameState` needs no SQL schema change. `json_extract` queries fields directly (`SQLiteGameRepository.getStateField('$.character.name')`).
- SQLite gives atomic transactions, so a log row and the state it produced are always written together.
- The `('game_state','main')` document has the same shape as a future server MongoDB `players` document, so sync maps 1:1.

The repository talks to a small `SqlDatabase` interface. The app passes `expo-sqlite` (async API, `withExclusiveTransactionAsync`); tests pass Node's built-in SQLite, so the real SQL is under test.

### Save versions

`GameState.saveVersion` plus ordered pure migrations in `src/engine/migrations.ts` (`MIGRATIONS[n]` upgrades v`n` to v`n+1`). A save newer than the app is refused instead of being overwritten. To change the shape: bump `CURRENT_SAVE_VERSION`, add the migration and a frozen fixture of the old version under `tests/fixtures/`.

Current version: **13**.

- v1 → v2 adds `flags.debugUsed` (set to `false` for old saves).
- v2 → v3 (2026-10-26): attributes become strength→strength, dexterity→dexterity, constitution→endurance, intelligence→intelligence, each set to **max(old value, 10)** so old heroes match the new-hero baseline (owner decision); agility and charisma are dropped; `character.hp`/`maxHp` are dropped; `stamina` is added full (100/100); every equipped and inventory item gets a `defId` (stackables: their id; starting gear: `start-<defId>`). Literals in the migration are frozen on purpose, so later config changes cannot change what it produces.

- v3 → v4 (2026-10-26): `character.hp` = max HP at the hero's level (`50 + 10 × (level − 1)`, frozen literals), `character.hpRegenProgress = 0`, `dungeon = {lastFight: null, totals: 0/0/0}`. The activity is kept (v3 only had woodcutting, so no save is in a dungeon).
- v5 → v6 (2026-10-26): training. Adds `training = {tier: 0, attributes: {each: {level: 0, xp: 0, progressMs: 0}}}` (frozen literals, including the four attribute keys). Nothing else changes: stored attributes stay the base values, and v5 had no training activity.
- v6 → v7 (2026-10-27): trees and the axe slot. A running woodcutting activity becomes `{kind:'woodcutting', treeId:'oak', progressMs: 0}` (the banked part of one old 3 s action is dropped); the `axe` equipment slot gets the Wooden Axe (`start-wooden_axe`, frozen literals). Woodcutting level, XP, logs and everything else are kept.
- v7 → v8 (2026-10-27): merchant. `merchant = {charges: 5, chargeProgressMs: 0, stock}` with the 4 listings (Health Potion ×10 at 12, Iron Axe 600, Iron Sword 500, Iron Helm 400) in the first slots and as many slots as `inventory.capacity` (20 when missing); `nextItemSerial = 1`; the stale per-instance `rarity` is dropped from every equipped and inventory item. Frozen literals. Everything else is kept.
- v8 → v9 (2026-10-27): live combat and the XP rebalance. **Hero XP rule: the level is kept; XP is clamped into progress toward the next level on the new curve, `xp = min(xp, newXpToNext(level) − 1)`, and `xpToNext` becomes the new curve's value.** Nobody loses a level; XP beyond the new requirement is dropped (under the new curve it would have been a level-up, but granting levels in a migration was not asked for). A dungeon run in progress becomes its **search** phase with `progressMs` kept and `fight: null`; when the kept time already covers the new, shorter search, the fight starts on the next simulate (the frozen v8 fixture is such a case: 3:27 banked vs a 1:50 search). The last fight's log gets each strike's time and number (v8 round n → `atMs = n × 1000`, `strike = n`, which is exactly when it would land under 1.8.0), `rounds` becomes `durationMs = rounds × 1000`, and `round_cap` becomes `time_limit`. Frozen literals (the base-100 curve and its segments, 1000 ms per v8 round). Everything else is kept.
- v9 → v10 (2026-10-28): buildings, mining, the pickaxe slot. Owner decision (wiping was fine): existing saves get buildings **exactly like a new save**: Woodcutting, Mine Shaft, Town Hall and Training Grounds all locked. A running **woodcutting or training** activity stops cleanly (`activity = null`; logs and training XP kept, the log in progress dropped); a dungeon run is kept. The `pickaxe` slot gets the Wooden Pickaxe (`start-wooden_pickaxe`); `skills.mining` is added at Lv1 when missing (kept when present); the Iron Pickaxe listing goes in merchant stock slot 4 when that slot exists and is empty (v9 stocked 4 listings), so it can be bought before the next refresh. The training tier already bought is kept. Frozen literals. Everything else is kept.
- v10 → v11 (2026-10-28): building upgrades, the builder, workers. Buildings keep their state and level (built = Lv1); the Merchant becomes a stored building, built at Lv1; `construction = null` (idle builder); `workers` empty; the merchant stock is kept as it is until the next refresh. Frozen literals. Everything else is kept.
- v11 → v12 (2026-10-31): skill XP rebalance (base 500 → 100, own segments). **Each skill keeps its total XP** (every level below on the v11 curve + XP into the level) and gets the level and XP-into-level that total gives on the v12 curve (owner-approved: testers jump levels; nobody drops one). A running gathering activity is kept with its progress (a higher level never locks a tree or rock). Frozen literals (both curves). Everything else is kept. Fixture: `tests/fixtures/save-v11-skills.json` + `log-v11-skills.json` (engine 1.11.0: WC Lv4 + 63 → Lv7, Mining Lv3 + 536 → Lv5, Oak running mid-log; tests in `tests/migrationV12.test.ts`).
- v13 → v14 (2026-11-01): gear quality and rarity. Every gear instance (equipped and in the inventory) and every gear listing in the current stock gets `qualityBp: 2500, rarity: 'common'` (listing prices kept); gear = a frozen list of the 16 equippable 1.13.0 item ids. At 25% the rescaled catalog gives exactly the old stats and prices. Frozen literals. Everything else is kept (pre-v14 jobs are materials). Fixture: `tests/fixtures/save-v13.json` + `log-v13.json` (engine 1.13.0: Crafting built, Iron Helm equipped, Iron Sword in the bag, Iron Axe / Iron Pickaxe in the stock, an Oak Plank job 8/20 mid-craft, Oak running, 2,125 gold; 12 rows; tests in `tests/migrationV14.test.ts`, which also crafts a Stone Sword with 20 stamina after the anchor, collects it and replays the whole log).
- v12 → v13 (2026-11-01): the Crafting house. `buildings.crafting = {state: 'locked', level: 0}` (like a new save); `crafting = {pipesUnlocked: 2, pipes: 8 × null, remainders: {}, nextJobSerial: 1}`; the unused `skills.smithing` is dropped. Frozen literals. Everything else is kept. Fixture: `tests/fixtures/save-v12.json` + `log-v12.json` (engine 1.12.0: Woodcutting and Mine Shaft built, 925 gold, 141 Oak Logs, 133 Stone, Stone running 0:47 into an ore, debug gold; 9 rows; tests in `tests/migrationV13.test.ts`, which also builds Crafting and crafts in both pipes after the anchor and replays the whole log).
- v4 → v5 (2026-10-26): dungeon tiers. The dungeon id `rat_cellar_1` becomes `rat_cellar` (running activity and last fight). Every v4 run was a Rat Cellar run, so `dungeon.byDungeon = {rat_cellar: totals}` (empty when there were no runs) and the old wins count toward the Bat Cave unlock. `totals` is kept. Frozen literals again.

Frozen fixtures that must keep loading: `tests/fixtures/save-v1.json` and `tests/fixtures/save-v2.json` (made with the 1.1.0 engine: hero Lv4, woodcutting Lv8, 3785 logs, banked progress), `tests/fixtures/save-v3.json` (made with the 1.2.0 engine before the dungeon: hero Lv5, DEX 15, END 12, woodcutting running, 68 stamina), and `tests/fixtures/save-v4.json` + `log-v4.json` (made with the 1.3.0 engine before the tiers: hero Lv3, DEX 13, END 12, Rat Cellar running mid-run, 19 runs / 18 wins / 1 loss, plus the action log that produced it, all rows at engine 1.3.0), and `tests/fixtures/save-v5.json` + `log-v5.json` (made with the 1.4.0 engine before training: hero Lv4, 198 gold, DEX 12, END 13, Bat Cave running mid-run, Rat Cellar 25 wins, Bat Cave 8 wins, plus its 11-row action log, all at engine 1.4.0), and `tests/fixtures/save-v6.json` + `log-v6.json` (made with the 1.5.0 engine before the trees: woodcutting Lv5 running mid-action, 1,338 Oak Logs, 9 nests, STR trained to 4, 94 stamina, plus its 10-row action log, all at engine 1.5.0), and `tests/fixtures/save-v7.json` + `log-v7.json` (made with the 1.6.0 engine before the merchant: Oak running mid-log, 1,120 gold, 123 Oak Logs, 12 Rat Skins, 24 Rat Cellar wins, plus its 9-row action log, all at engine 1.6.0), and `tests/fixtures/save-v8.json` + `log-v8.json` (made with the 1.7.0 engine before live combat: hero Lv3 with 1,182 XP, Rat Cellar running 3:27 into a run, 37 wins, 2 Health Potions bought, plus its 6-row action log, all at engine 1.7.0), and `tests/fixtures/save-v9.json` + `log-v9.json` (made with the 1.8.0 engine before buildings: hero Lv6, 265 gold, Training Tier 1, 36 Oak Logs, Oak running 1:47 into a log, 95 Rat Cellar wins, plus its 7-row action log, all at engine 1.8.0), and `tests/fixtures/save-v10.json` + `log-v10.json` (made with the 1.9.0 engine before workers: hero Lv6, 141 gold, Woodcutting, Mine Shaft and Town Hall built, 4 Oak Logs, 5 Stone, 2 Health Potions, Stone running 0:17 into an ore, 95 Rat Cellar wins, a 20-slot stock, plus its 12-row action log, all at engine 1.9.0), and `tests/fixtures/save-v11.json` + `log-v11.json` (made with the 1.10.0 engine before Training Grounds upgrades: Town Hall Lv2, Training Grounds Lv1, STR training mid-level, 1,025 gold, 52 Oak Logs, 52 Stone, debug-built, plus its 17-row action log, all at engine 1.10.0; same save version, so it only anchors).

**Rules version.** `ENGINE_VERSION` (`src/engine/version.ts`) is written on every log row. Bump it whenever rules change outcomes. **Every save-version bump also bumps `ENGINE_VERSION`** (`RELEASED_ENGINES` in `src/engine/version.ts`: save v1 → 1.0.0, v2 → 1.1.0, v3 → 1.2.0, v4 → 1.3.0, v5 → 1.4.0, v6 → 1.5.0, v7 → 1.6.0, v8 → 1.7.0, v9 → 1.8.0, v10 → 1.9.0, v11 → 1.10.0 and 1.11.0, v12 → 1.12.0, v13 → 1.13.0, v14 → 1.14.0; a guard test in `tests/golden.test.ts` checks it), so a replay span never mixes two save shapes under one engine version. `tests/golden.test.ts` pins the final state hash of a fixed seed and script, so an unintended rules change fails CI. 1.1.0: XP curve uses `L × √L`, and `flags.debugUsed` was added. 1.2.0 (2026-10-26): save v3, stamina regen in `simulate()`, stamina/attribute debug commands; woodcutting outcomes unchanged (same actions, levels and drops in the golden script). The golden script now also spends stamina and adds STR, so the hash changed. 1.3.0 (2026-10-26): save v4, HP regen, dungeon runs and combat. Woodcutting outcomes unchanged (same actions, levels, nests and stamina in the golden script); the script gained a dungeon segment (start, skip, HP debug, 3 h of runs, woodcutting cancelling a run), so the hash changed. 1.4.0 (2026-10-26): save v5, dungeon tiers 1–5, per-dungeon counters, unlocks, `DEBUG_ADD_DUNGEON_WINS`, MIGRATE anchors. Rat Cellar outcomes unchanged (a golden test pins the 1.3.0 part of the script: same runs, gold, HP, stamina, level); the hash changed because of `byDungeon` and the id rename. The script gained a tier segment (debug wins, Bat Cave runs). 1.5.0 (2026-10-26): save v6, training (tiers, per-attribute levels, effective attributes in every rule), `UNLOCK_TRAINING_TIER`, `DEBUG_ADD_TRAINING_XP`, `DEBUG_ADD_GOLD`. Every 1.4.0 outcome is unchanged (a golden test pins the whole 1.4.0 script: actions, runs, gold, HP, stamina, levels, loot); the hash changed because of the `training` field. The script gained a training segment (Tier 1, STR, switch to END, debug XP and gold, Tier 2, 10 h capped, debug XP to the cap, a Rat Cellar hour with trained attributes). 1.6.0 (2026-10-27): save v7, woodcutting trees, WS, axe slot, `SKIP_WOODCUT`, `SPEEDUP_TRAINING`, `DEBUG_ADD_WOODCUTTING_LEVEL`. Woodcutting outcomes changed on purpose (Oak 1:50 / 25 XP instead of 3 s / 10 XP), so far fewer nest rolls happen and the RNG stream shifts: the earlier golden pins were re-pinned (dungeon runs, wins, levels, HP, stamina unchanged; gold differs). The script gained a 1.6.0 segment (Oak, bound skip, +4 WC levels, Birch, STR speed-up +10 min and to next level). 1.7.0 (2026-10-27): save v8, merchant (refresh charges, stock, `BUY_ITEM`, `SELL_ITEM`, `REFRESH_MERCHANT`), `EQUIP_ITEM`, `UNEQUIP_ITEM`, `USE_ITEM`, `DEBUG_ADD_MERCHANT_CHARGE`, item quality and prices in the catalog. Every 1.6.0 outcome is unchanged (a golden test pins the whole 1.6.0 script); the hash changed because of the new fields and the dropped `rarity`. The script gained a 1.7.0 segment (debug gold, buy potions and the Iron Axe, equip it, potion, sell logs and the Wooden Axe, refreshes, 5 h of charge regen, debug charge, a buy and equip while woodcutting). 1.8.0 (2026-10-27): save v9, live combat (a run = search + a fight played in engine time; per-side attack intervals, hero first on ties; `maxFightMs` 60 s replaces 50 rounds; `FIGHT_IN_PROGRESS`; the skip ends the search only), searches 2/3/5/8/12 min, hero XP curve base 100, Rat XP 35, attack interval as a derived stat. Outcomes changed on purpose, so every golden pin was re-pinned; the script's first skip now sends what the screen shows mid-search, its debug XP grant is 16k instead of 250k (still about Lv11), and a 1.8.0 segment was added (Rat Cellar, search skip, a simulate boundary and a debug HP change mid-fight, 1 h of runs). 1.9.0 (2026-10-28): save v10, buildings (`BUILD`, `DEBUG_BUILD`, `BUILDING_LOCKED`), mining (`SKIP_MINE`, `DEBUG_ADD_MINING_LEVEL`, pickaxe slot, Iron Pickaxe in the stock), a fight in progress at the offline cap is finished. The script builds Woodcutting with `DEBUG_BUILD` before its first log and the Training Grounds with `DEBUG_BUILD` instead of buying Tier 1, so every later gold value is 100 higher and nothing else changed (a golden test pins the whole 1.8.0 script); the Iron Helm buy names slot 4. A 1.9.0 segment was added (real BUILD of the Mine Shaft, 1 h of Stone, a bound SKIP_MINE, debug mining levels, the Iron Pickaxe for Copper, the Wooden Pickaxe re-equipped (Copper stops), a real BUILD of the Town Hall, then the Rat Cellar and 20 h away). 1.10.0 (2026-10-28): save v11, power-based yield (one more RNG draw per log and ore; Oak and Stone need 20), `UPGRADE_BUILDING` / `DEBUG_FINISH_CONSTRUCTION` and the builder, building bonuses, the merchant's random stock (seeded) and new items, workers (`HIRE_WORKER`, `DISMISS_WORKER`, `ASSIGN_WORKER`, `UNASSIGN_WORKER`, crews, upkeep), the world walk. Outcomes changed on purpose (more logs per cut, shifted RNG stream), so every golden pin was re-pinned; the Iron Helm buy after the refreshes became the Iron Gloves the rolled stock holds in that slot. A 1.10.0 segment was added (two hires, crews on Oak and Stone beside Rat Cellar runs, the hero on Oak beside the Oak crew, a real Town Hall upgrade with a simulate boundary mid-build, a third worker, ~10 h away; the crews end paused for gold). 1.11.0 (2026-10-28, **engine-only bump, save v11 unchanged**): Training Grounds upgrades and training XP per minute by their level. Path for an engine-only bump: append `{engine, save}` with the same save version to `RELEASED_ENGINES`; on load the client writes a `MIGRATE` anchor with `fromSave = toSave` (no migration runs); add a frozen fixture written by the previous engine (`tests/fixtures/save-v11.json` + `log-v11.json`, engine 1.10.0: Town Hall Lv2, Training Grounds Lv1, STR training, 52 Oak Logs / 52 Stone, 17 rows) and test that it anchors and replays (`tests/trainingUpgrades.test.ts`). Every 1.10.0 outcome is unchanged (a golden test pins the whole 1.10.0 script's hash: its Training Grounds stay at Lv1); the script gained a 1.11.0 segment (a real Training Grounds upgrade to Lv2 while STR trains, a simulate boundary mid-build, the upgrade completing mid-training, a speed-up at 2 XP/min). 1.12.0 (2026-10-31): save v12, the skill XP curve (base 100, own segments) and the v11 → v12 skill migration. Skills level faster in the golden script, so WS / MS and the yield rise: the woodcutting and mining pins (levels, XP, logs, ores) and the final hash were re-pinned; dungeon runs, gold, HP, stamina and training are unchanged. The frozen v2 / v3 / v9 / v10 / v11 fixtures now also run v11 → v12 (only their skills change). 1.13.0 (2026-11-01): save v13, the Crafting house (`START_CRAFT`, `INSTA_CRAFT`, `CANCEL_CRAFT`, `DEBUG_UNLOCK_PIPE`), pipes in the world walk, INT's craft time reduction (`diminishingBp`), smithing removed. Every 1.12.0 outcome is unchanged: seen in the v12 shape (no Crafting house or pipes, smithing back, save 12) the 1.12.0 script's state hashes to the 1.12.0 pin (`94897c6a`), and the 1.10.0 script's to `d6b0bd86` (`asV12` in `tests/golden.test.ts`). The script gained a 1.13.0 segment (a real BUILD of Crafting, Oak Planks ×300 and an x10 Stone Brick job, a simulate boundary mid-craft, a real house upgrade completing mid-job, a cancel with refunds, an insta, gear unequipped and a shield bought to fill the inventory, a debug pipe, a held Copper Ingot pipe released by a sale, ~9 h away). Every older fixture also runs v12 → v13. 1.14.0 (2026-11-01): save v14, gear quality and rarity (instance `qualityBp` / `rarity`, stats and prices scaled by quality; catalog gear stats ×1.6 as 100% maxima), Merchant gear rolls on their own stream, 30 gear recipes, `COLLECT_CRAFT`, the `ready` pipe. Every 1.13.0 outcome is unchanged: with its gear listings reset to the 1.13.0 terms after each refresh (25%, common, catalog price; `as113Stock`) and seen in the v13 shape (`asV13`: no gear rolls, save 13), the whole 1.13.0 script hashes to the 1.13.0 pin (`073a47bf`). The script gained a 1.14.0 segment (debug gold, a real refresh and a rolled buy at the price shown, a sale by quality, three gear jobs with 20 / 0 / 5 stamina, a simulate boundary mid-craft, a cancel (inputs back, stamina lost), an insta to ready, 2 h with the pieces waiting, Done ×2, the sword equipped). Every older fixture also runs v13 → v14.

**Known limit, still open:**
- The SQL schema has only `schema_version = 1` in `meta` and `CREATE TABLE IF NOT EXISTS`. Add ordered SQL schema migrations keyed on `meta.schema_version` before the first table change.

## Action log & sync

`action_log(seq, command_id UNIQUE, type, payload JSON, client_time, engine_version, state_hash, synced)` is append-only. Every stored state change is one transaction: log row(s) + state document. Never one without the other.

| type | When | Payload |
| --- | --- | --- |
| `NEW_GAME` | First launch, Reset save | `{ seed }` (`+ reason, debugUsed: true` after Reset save) |
| `START_ACTIVITY`, `STOP_ACTIVITY`, `SKIP_DUNGEON_RUN` (search only), `SKIP_WOODCUT`, `SKIP_MINE`, `BUILD`, `DEBUG_BUILD`, `UPGRADE_BUILDING`, `DEBUG_FINISH_CONSTRUCTION`, `HIRE_WORKER`, `DISMISS_WORKER`, `ASSIGN_WORKER`, `UNASSIGN_WORKER`, `START_CRAFT`, `INSTA_CRAFT`, `CANCEL_CRAFT`, `DEBUG_UNLOCK_PIPE`, `DEBUG_ADD_MINING_LEVEL`, `SPEEDUP_TRAINING`, `DEBUG_ADD_WOODCUTTING_LEVEL`, `EQUIP_ITEM`, `UNEQUIP_ITEM`, `USE_ITEM`, `REFRESH_MERCHANT`, `BUY_ITEM`, `SELL_ITEM`, `DEBUG_ADD_MERCHANT_CHARGE`, `UNLOCK_TRAINING_TIER`, `DEBUG_ADD_TRAINING_XP`, `DEBUG_ADD_GOLD`, `DEBUG_GRANT_HERO_XP`, `DEBUG_SPEND_STAMINA`, `DEBUG_REFILL_STAMINA`, `DEBUG_ADD_ATTRIBUTE`, `DEBUG_SET_HERO_HP`, `DEBUG_FINISH_DUNGEON_RUN`, `DEBUG_ADD_DUNGEON_WINS` | Player/debug commands; `command_id` = command id | the command |
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

Shown after app start, a return from background or a debug clock change when **at least 60 s of real time passed and there was at least one log cut, ore mined, dungeon run, training XP point, training cap reached, worker action, upgrade finished, craft finished or gear piece ready to collect** (`AWAY_SUMMARY_MIN_MS` in `config/time.ts`), or when there was **any clock anomaly**. A quick app switch is still simulated and logged, but opens no modal. It lists logs cut and the count per log type, dungeon runs (won/lost), dungeons unlocked, hero XP, gold and loot next to gathering results, plus training XP and levels per attribute and a "maxed — unlock Tier N" note for each attribute that hit its cap; since 1.10.0 also the workers' items, the upkeep paid and the upgrades finished; since 1.13.0 the items crafted per output type.

The summary is an RN `<Modal>`. On iOS it presents from the view controller that owns it, and the root controller cannot present while a full-screen village modal is up, so each village modal route renders its own `<AwayModal />` and the root one hides on those routes (`RootAwayModal` in `src/app/_layout.tsx`).

## Debug tools

`DEV_TOOLS_ENABLED` in `src/engine/config/dev.ts` shows a Debug panel on the Hero tab. It stays on for the POC. Any `DEBUG_*` action sets `state.flags.debugUsed = true` forever (it survives later play, Reset save and replay), so a future server can tell debugged saves apart. The clock buttons change a persisted **offset** on the client clock (`SystemClock.offsetMs`), then resume, so the engine sees exactly what a player who changed the phone clock would produce. "+10k hero XP" is a real logged command (`DEBUG_GRANT_HERO_XP`), and so are "Spend 10 stamina" (`DEBUG_SPEND_STAMINA`, refused with `NOT_ENOUGH_STAMINA` below 10), "Refill stamina" (`DEBUG_REFILL_STAMINA`), "+1 STR / DEX / END / INT" (`DEBUG_ADD_ATTRIBUTE`, 1–1000 per command, an attribute can reach at most 1,000,000), "Hero HP → 1" (`DEBUG_SET_HERO_HP`, 0..max, clears the regen remainder) and "End search now (free)" (`DEBUG_FINISH_DUNGEON_RUN`, ends the current search like a skip without stamina, so the fight starts; refused with `FIGHT_IN_PROGRESS` during the fight and `NO_DUNGEON_RUN` when no dungeon runs). In a dungeon's detail view, "+10 wins (debug)" (`DEBUG_ADD_DUNGEON_WINS`, 1–1000 per command, unlocked dungeons only) adds wins and runs to that dungeon's counters with no fight and no rewards, so unlocks can be tested on the phone. "+60 min training XP" (`DEBUG_ADD_TRAINING_XP {xp}`, 1–100,000 per command) adds training XP to the attribute being trained right away, with the same level-ups and cap rule as real time (refused with `NOT_TRAINING` when nothing trains); "+1 WC level" (`DEBUG_ADD_WOODCUTTING_LEVEL {levels}`, 1–100 per command, level at most 1,000, XP toward the next level kept) to test tree unlocks; "+1 Mining level" (`DEBUG_ADD_MINING_LEVEL`, same bounds) to test rock unlocks; "Build free (debug)" in a locked building's Build sheet (`DEBUG_BUILD`, requirements ignored, effects applied, refused with `ALREADY_BUILT`); "+1,000 gold" (`DEBUG_ADD_GOLD {amount}`, 1–1,000,000 per command, gold at most 10¹²). "Finish now (debug)" in the Upgrade sheet while that building upgrades (`DEBUG_FINISH_CONSTRUCTION`, refused with `NO_CONSTRUCTION` when the builder is idle). In the Merchant's Buy tab, "+1 merchant refresh (debug)" (`DEBUG_ADD_MERCHANT_CHARGE`, never above max; refused with `CHARGES_FULL`). "Unlock next pipe" (`DEBUG_UNLOCK_PIPE`, opens the next crafting pipe up to 8; refused with `PIPES_MAXED`). "Reset save" logs `DEBUG_RESET_SAVE` + `NEW_GAME` and clears the offset; it never deletes log rows. None of them change engine rules.
