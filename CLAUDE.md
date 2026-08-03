# Redemption — Roll20 Custom Character Sheet

A custom character sheet for **Redemption**, a roll-under tabletop RPG, running on Roll20.net's VTT. Started 2022; actively maintained. No build system, no package manager, no tests — it's raw HTML/CSS/JS edited directly and loaded into Roll20.

## Files

- **`Redemption Roll20.html`** — the sheet: HTML markup + the sheet-worker JS (all inside one `<script type="text/worker">` block near the end). ~5000 lines.
- **`Redemption Roll20.css`** — the sheet styling.
- **`RedemptionTagSync.js`** — a Roll20 **Mod (API) script** (server-side, pasted into the game's Settings → API Scripts). Syncs the shared Tag Journal across characters. Requires Pro on the game.
- **`RedemptionMissileDefense.js`** — a second **Mod (API) script**. The missile attack card's "Apply Salvo" button sends `!missiledrain <targetTokenId> <salvo>`; the script drains the targeted ship's Counter Missile Margin (`starshipIntercept`) first, overflow spilling into `DefMargin` (both floored at 0). Anyone may apply (toggle `ANYONE_MAY_APPLY`). Requires Pro.
- **`RedemptionCharacterExport.js`** — a third **Mod (API) script** (GM only). `!exportchars [name] [json|md]` writes character sheets to a "Redemption Character Export" handout. Markdown (default) is a curated summary for a planning assistant; JSON is full flat-attribute + repeating-row fidelity (`{name, attributes, repeating}`) built to round-trip for the Phase 4 Export/Import tab. No name = all player-controlled characters. Requires Pro.
- **`Original/`** — pristine pre-work reference copies of the HTML/CSS. Diff against these to see what changed / recover original behavior.
- **`Phase 2/`** — the CSE-migration version of the sheet (see roadmap). **The live sheet is the Legacy version in the project root, NOT this.**
- `Back ups/`, `Game Settings/`, `Character Comparison/` — captured artifacts from debugging sessions.

## How to verify (CRITICAL: I cannot run Roll20)

There is no local runtime. **The user tests everything in Roll20** — typically in a "Copy" duplicate game before the live one. My job is to make correct changes and hand the user a precise test plan. After any edit:
- Balance-check: HTML `<div>`/`</div>` counts, `<script>`-section `{`/`}` counts, CSS `{`/`}` counts. The HTML has a benign pre-existing div imbalance (~ -2) that matches `Original/` — compare against that baseline, don't chase it.
- `node -c RedemptionTagSync.js` syntax-checks the Mod script.
- Never claim something works — say it's ready to test and give the exact steps + what to watch in the browser/API console.

## Editing conventions

- The file uses **tab indentation**. The Edit tool's exact-match often fails on whitespace — when it does, use `sed -i 'Ns#old#new#'` with line numbers (find them via Grep first). Use `#` as the sed delimiter (the code is full of `/` and `|`).
- Prefer surgical edits; when a fix is speculative, comment the old code out in place rather than deleting it (user preference).
- Match the surrounding style (it's idiosyncratic 2022 code — lots of console.logs, verbose async).

## Roll20 landmines (these have each cost real debugging time)

**Sanitization mode:** the live sheet runs under **Legacy** sanitization. That means: CSS class selectors MUST be `.sheet-`-prefixed (`.sheet-TopPanel`) while the HTML class is unprefixed (`class="TopPanel"`) — Roll20 matches them. You **cannot** target Roll20's own generated classes (e.g. `.repcontainer`) in CSS — Legacy strips non-`sheet-` class selectors. (CSE mode, parked in `Phase 2/`, drops the prefix requirement — Phase 2 roadmap item.)

**Sheet workers:**
- `disabled` inputs do **not** display sheet-worker `setAttrs` updates — use **`readonly`** for worker-computed display fields. (`disabled` number inputs are also treated as auto-calc.)
- **Auto-calc fields (`value="@{formula}"`) are deprecated** and warn/misbehave under JumpGate — this sheet was migrated to worker-computed `readonly` fields.
- `on("change:X")` fires only for existing attributes; **new** attributes fire `on("add:X")`. Handle both when first-touch matters.
- `calcTagModifier()` and `calcAllTaskNumbers()`/`calcTaskNumber()` are **delicate async** — they accumulate across per-row `getAttrs` callbacks and had race bugs. They use a completion-gate pattern (`tagCounter`/`sectionsRemaining`, per-call `skillTally`). Don't fire dependent writes until the gate closes.

**Rolls & templates:**
- Custom roll template is `&{template:redemption}`. Its CSS keeps the `sheet-` prefix **even under CSE** (documented exception), and it renders in **chat, outside `.charsheet`** — so its CSS must use **literal colors**, not the `--var()` tokens (which only exist on `.charsheet`).
- `@{target|...}` targeting works in `type="roll"` **button values** but NOT reliably in `startRoll()`. In JS-built (`startRoll`) rolls, **interpolate attribute values** (`values.x`) rather than embedding `@{x}`.
- CSS `content:` must use the **literal Unicode char** (`"✓"`), not a backslash escape (`"\2713"`) — the escape makes Roll20's sanitizer reject the whole stylesheet.
- Never base64-embed fonts into the CSS — it blows Roll20's stylesheet size limit and the entire sheet goes unstyled. Fonts come from Google Fonts via `@import` only.

**Mod/API scripts (server-side):**
- `getSectionIDs()` / `setAttrs()` do **not** exist server-side. Use `findObjs({_type:"attribute", _characterid})` + regex on names, and `createObj`/`.set`/`.remove`.
- **Attribute-name casing is engine-dependent:** **Legacy lowercases** names server-side (`attr_tagJournalMaster` → `tagjournalmaster`); **JumpGate PRESERVES the authored case** (confirmed 2026-07-19 — the switch attribute is literally `tagJournalMaster`). Our test/Copy game runs JumpGate (`VTT Engine: jumpgate` in the browser log). So a Mod script must **match attribute names case-insensitively**, and when it writes to other sheets it must **mirror the source attribute's exact name string** rather than rebuilding it from lowercased constants — that's correct on both engines. (This bit `RedemptionTagSync.js`: `Master: none set` because it matched `tagjournalmaster` and the real name was `tagJournalMaster`.)
- Underscore (`_`) is available. Repeating row IDs can be **reused across characters** (this is how per-character state is preserved during sync).
- **Diagnosing sandbox visibility:** Mod-script `log()` output goes to the **API Script console** (Settings → Mod Scripts), NOT the browser F12 console. `RedemptionTagSync.js` has a GM-only `!tagsync debug` command that dumps every character's master-switch value + journal-row count — use that pattern to see what the sandbox actually sees.

## Game mechanics (needed to reason about the logic)

- **Roll-under.** Target Number = 2 attributes + a skill. Difficulty sets the dice pool: Easy 3d6 / Standard 3d8 / Difficult 3d10, plus Automatic (TN 3) and Impossible (TN 30). **Margin of success = TN − sum of dice.**
- **Tags** (rank 1–3) are narrative facts. Per roll a tag can be **invoked** (▲, shifts the pool easier by its rank), held (⊝), or **condemned** (▼, harder). `invokeMod` = Σ(rank × use) over unlocked tags; it's **global across all tabs by design** (characters pilot Mecha on the Starship tab, units pilot starships).
- **Tag Journal** (config tab, `repeating_tagJournal`) = a **shared** pool of scene/free tags, distinct from a character's personal tags. Roll→tag conversion: margin 0–9 → rank 1, 10–19 → rank 2, 20+ → rank 3.
- Tabs: Character / Starship (also Mecha) / Unit / Tag Journal.

## Theme

Art-deco / retro-futurist, matched to the game's cover: indigo-navy ground (`#1b2130`), warm gold (`#caa03e`/`#f0d488`), slate-blue secondary (`#45516c`). Fonts (Google Fonts): **Asimovian** (headers/labels), **Oswald** (buttons/chips — condensed, avoids overflow), **Share Tech Mono** (numeric readouts). Panels use a two-layer `clip-path` cut-corner (gold wrapper + inset panel).

## Roadmap

**Phase 1** (in progress): sound in Legacy — done: JumpGate fixes, art-deco reskin, auto-calc→worker migration, `&{template:redemption}` roll template showing invoked/condemned tags. Both Mod scripts built and in live testing — **(1) Tag Journal sync** (`RedemptionTagSync.js`), **(2) missile-salvo drain** (`RedemptionMissileDefense.js`, Counter Missile Margin first then Defense margin, via an "Apply Salvo" card button).
**Phase 2**: migrate Legacy → CSE (game-settings toggle; CSS/HTML prep parked in `Phase 2/`).
**Phase 3**: submit as an official Roll20 community sheet (needs freely-redistributable assets — hence Google Fonts, not the licensed book fonts).
**Phase 4** (future): an **Export/Import tab** on the sheet — paste the `RedemptionCharacterExport.js` JSON and have a worker fill the sheet from it (round-trip). Enables a web-based character creator on the Silent Spirits site.

Detailed session history, decisions, and current status live in the auto-memory files (`MEMORY.md` + linked notes) and the plan file `~/.claude/plans/inherited-pondering-waffle.md`.
