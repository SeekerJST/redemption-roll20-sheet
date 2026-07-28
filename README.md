# Redemption — Roll20 Character Sheet

A custom [Roll20](https://roll20.net) character sheet for **Redemption**, a roll-under, tag-driven tabletop RPG. Art-deco / retro-futurist theme, built for the Roll20 VTT, with two optional server-side Mod (API) scripts for shared scene tags and missile combat.

> **Redemption** (the game system and its setting) is separate intellectual property. This repository covers only the Roll20 sheet implementation and its companion scripts.

## Features

- Character, Starship/Mecha, Unit, and shared **Tag Journal** tabs.
- Roll-under task resolution with a difficulty-driven dice pool (3d6 / 3d8 / 3d10, plus Automatic and Impossible).
- **Tag system** — invoke (▲) / hold (⊝) / condemn (▼) narrative tags that shift the dice pool; a custom `&{template:redemption}` roll template reports which tags were invoked or condemned against each roll, plus a weapon's damage multiplier, type, and scale.
- Worker-computed target numbers (the deprecated auto-calc fields were fully migrated), and a roll template that stays legible in Roll20 light **and** dark mode.
- **Use Automation** master toggle that gates the optional Mod-script features — the sheet is fully standalone when it's off.

### Optional Mod (API) scripts — require Roll20 Pro

- **`RedemptionTagSync.js`** — designates one sheet as the master Tag Journal and syncs its scene tags (text / rank / type) to every other character, while each player keeps their own invoke/condemn state.
- **`RedemptionMissileDefense.js`** — the missile attack card's **Apply Salvo** button drains a targeted ship's Counter Missile Margin first, spilling any overflow into its Defensive margin (both floored at 0).

## Installation

### The sheet (any Roll20 game)

1. **Settings → Game Settings → Character Sheet Template → Custom**.
2. Paste `Redemption Roll20.html` into the **HTML Layout** box and `Redemption Roll20.css` into the **CSS Styling** box.
3. Save. The sheet runs under **Legacy** sanitization (see [Development](#development)).

### The Mod scripts (Roll20 Pro only)

1. **Settings → Mod (API) Scripts → New Script**.
2. Paste `RedemptionTagSync.js` and/or `RedemptionMissileDefense.js` as separate scripts and **Save Scripts**.
3. On each sheet, turn on **Use Automation** (top tab row) to expose the script-driven controls.

Without Pro / the scripts the sheet works fully on its own — the automation controls simply stay hidden.

## Usage notes

- **Tag Journal sync:** on the Tag Journal tab, flip **Master Journal** on for the one sheet that should own the shared scene tags. GM chat commands: `!tagsync` force-pushes from the master, `!tagsync verbose on|off` toggles console logging, `!tagsync debug` dumps what the sandbox sees.
- **Missile salvo:** target an enemy ship with a missile attack, then click **Apply Salvo** on the resulting card to drain its defenses. Requires **Use Automation** on.

## Game mechanics (quick reference)

- **Roll-under.** Target Number = two attributes + a skill. Difficulty sets the pool: Easy 3d6 / Standard 3d8 / Difficult 3d10 (plus Automatic TN 3, Impossible TN 30). Margin of success = TN − sum of dice.
- **Tags** are rank 1–3 narrative facts; invoking shifts the pool easier by the tag's rank, condemning shifts it harder.
- **Tag Journal** holds shared scene / free tags; rolls convert to tags at margin 0–9 → rank 1, 10–19 → rank 2, 20+ → rank 3.

## Development

No build system, package manager, or automated tests — the files are edited directly and pasted into Roll20.

- **Live sheet runs Legacy sanitization:** CSS class selectors are `.sheet-`-prefixed while HTML classes are unprefixed, and Roll20's own generated classes can't be targeted. A CSE-mode variant is parked in `Phase 2/`.
- `Original/` holds pristine pre-work copies of the HTML/CSS for diffing.
- `node -c RedemptionTagSync.js` / `node -c RedemptionMissileDefense.js` syntax-check the Mod scripts. The sheet itself can only be verified inside a live Roll20 game.
- `CLAUDE.md` documents the project's conventions and the Roll20 landmines learned along the way.

## Roadmap

- **Phase 1** — sound in Legacy: JumpGate fixes, art-deco reskin, auto-calc → worker migration, `&{template:redemption}` roll template, and both Mod scripts. *(near complete)*
- **Phase 2** — migrate Legacy → CSE (prep parked in `Phase 2/`).
- **Phase 3** — submit as an official Roll20 community sheet.

## Credits & licensing

- Fonts load from **Google Fonts** (Asimovian, Oswald, Share Tech Mono) so the sheet stays freely redistributable.
- Sheet code and Mod scripts are released under the MIT License (see `LICENSE`).
- "Redemption" the game system / setting is separate IP and is **not** covered by this license.
