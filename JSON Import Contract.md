# Redemption — JSON Import Contract

The authoritative spec for the JSON the online **character generator** and **gear creator**
export so it can be imported into the Roll20 sheet's **Import** tab. This is the consumer-side
contract: the generators must key everything by the **sheet's own attribute + repeating-row
field names** listed here.

Status (2026-10-18): Character import **done + verified**. Starship import **built, pending
live test**. Weapons/Armor **planned** (fields listed below; the gear creator still needs to add
a resolved `stats` block).

---

## 1. How import works (so the contract makes sense)

- The sheet has an **Import** tab: paste JSON → click **Import**. A sheet worker
  (`clicked:importChar`) parses it and writes the sheet.
- The importer is **section-agnostic**: it `setAttrs` every flat attribute, then for every
  repeating section it creates one row per entry and writes **whatever field keys the row
  object carries** into `repeating_<section>_<rowid>_<field>`. No per-section code — so adding a
  new section is purely a generator-side change as long as the keys match the sheet.
- **Sheet workers can CREATE repeating rows but NOT delete them.** So **import onto a FRESH
  sheet** — rows are *added*, not replaced. Re-importing the same entity duplicates its rows.
  (Bulk overwrite/re-import would need a Mod/API script; not built.)
- **Derived fields are recomputed by the sheet** from the imported inputs — do NOT export them
  (they're ignored or overwritten). Examples: `BodyMax` (mirror of `BodyMaxHdn`), `RefreshRating`,
  `StrainPerm`, all Task Numbers.
- The Roll20 **journal name is not a sheet attribute** — the import can't set it; the user
  renames the journal entry. (`name` in the JSON is only used for the status message.)
- **Select fields:** an imported value must equal one of the `<option value>` strings or the
  dropdown won't show it (the attribute is still set). See the enums noted below.
- **current/max pairs:** for anything with a current + max (+ hidden) trio, export all of them,
  setting current = max so the sheet imports "full."

## 2. Payload shape

```jsonc
{
  "format": "redemption-roll20-sheet",   // informational; importer keys off "attributes"
  "name": "Display Name",                 // status-message only; does NOT set the journal name
  "attributes": { "<sheetAttrName>": <value>, ... },
  "repeating": {
    "<sectionName>": [ { "<rowFieldName>": <value>, ... }, ... ],
    ...
  }
}
```

For a **gear** export (which also carries its build tree), put the importable block under
`stats` instead of at the top level — the importer accepts either:

```jsonc
{ "format": "redemption-item", "item": { ...build tree... },
  "stats": { "attributes": {...}, "repeating": {...} } }
```

The importer uses `data` if it has `.attributes`, else `data.stats`.

---

## 3. Character contract (format: redemption-roll20-sheet) — DONE

Export **source/input fields only**, never computed ones. Verified importing "Caria Pezal".

**Flat `attributes`:** `Concept`/`ConceptRank`, `Trouble`/`TroubleRank`, `Race`/`RaceRank`;
the six attributes `Kinestetic`,`Logical`,`Spatial`,`Interpersonal`,`Introspection`,`Verbal`;
FP pools `AttribFP`,`SkillsFP`,`TagsFP`,`BodyFP`,`GearFP`,`IncomeFP`,`IncomeLimFP`;
`BodyMaxHdn` (NOT `BodyMax`), `BodyCurr`, `StrainPerm`?/`StrainCurr`, `XP`;
skill groups `grp1SkillName`/`grp1SkillRank`/`grp1Specialty` (and grp2, grp3);
equipment `EquipmentListOne..Four` + `EquipmentCCOne..Four` + `EquipmentCROne..Four`
(**4 fixed slots**, not a list — a 5th+ item overflows).

**Repeating:**
| Section | Row fields | Notes |
|---|---|---|
| `skills` | `skillName`, `specialty`, `skillRank` | `skillName` is the sheet's **lowercase** select value (`stealth`, `pilot`, `firearms`, …) |
| `tags` | `tagText`, `tagRank`, `tagType` | `tagType` enum: `Equipment`, `Free`, `Group`, `Personal`, `Psionic`, `Psigear`, `Wound` |

---

## 4. Starship contract (format: redemption-roll20-sheet) — BUILT, pending live test

A starship imports onto its own (fresh) ship character, filling the **Starship** tab.

**Flat `attributes`:**
`starshipSize`; `starshipBody`(+`starshipCurrBody`,`starshipCurrBodyHdn`); `starshipHull`
(Hull/Armor Rating); `starshipForceField`(+`starshipForceFieldCurr`),`starshipFFRegen`;
`starshipPowerSlots` (0–12 count; `starshipPowerSlotOne..Twelve` are the per-slot used
checkboxes); `starshipLifeSupport`; `starshipMaxFuel`(+`starshipCurrFuel`,`starshipCurrFuelHdn`);
`starshipCompRank`,`starshipCompScope` (Minor/Moderate/Major); `starshipEvasion` (Evasive
Margin); `starshipIntercept` (Counter Missile Margin); `starshipInitMod`;
direct-fire weapon `starshipWeaponName`,`starshipWeaponMultiplier`,`weaponType`,
`starshipWeaponBleed`; missiles `starshipMissileSalvo`,`starshipMissileLaunchers`,
`starshipMissileMagazine`.

**Repeating:**
| Section | Row fields |
|---|---|
| `starshipDrives` | `starshipDriveName`, `starshipDriveScale` (Minor/Moderate/Major), `starshipDriveManeuver` (0–4), `starshipDriveLim` |
| `starshipComms` | `starshipCommsName`, `starshipCommsScale`, `starshipCommsResource` |
| `starshipTasks` | `starshipTaskName`, `starshipTaskRank` |
| `starshipLimitation` | `starshipLimitationName` |
| `starshipTags` | `tagText`, `tagRank`, **`starshipTagType`** |
| `starshipCapabilities` | `starshipCapabilitiesName`, `starshipCapabilitiesScale`, `starshipCapabilitiesRank`, `starshipCapabilitiesResource`, `starshipCapabilitiesPowerSlots` |

**Gotchas for the generator:**
- Starship tags key the type as **`starshipTagType`** (not `tagType`); the other tag fields are
  the shared `tagText`/`tagRank`.
- Limitation rows store **name only** — the sheet has no limitation-scale field (build `LimitScale`
  is dropped). Add a field later if needed.
- Drive `starshipDriveScale`/`starshipDriveManeuver` were just given `name` attributes so they
  persist; they require the sheet build that added them (commit on `dev` for the Import tab work).
- **Mapping the build tree → these values is the generator's job** (Rank/Scale → Hull/Body/
  Multiplier/Evasion/…), since only the generator has the rules tables. The importer only writes
  resolved values. Open mapping questions: build "Armor Rating" → `starshipHull` (ship structure
  is Hull/Body/ForceField — three fields vs one build component; a ship with no FF component → FF 0);
  each build Drive (+ its Maneuver child) → one `starshipDrives` row.

See `scratchpad` sample `corsair_sheet.json` (the Security Escort/Corsair) for a worked example.

---

## 5. Weapons & Armor contract — PLANNED (not yet built on the sheet)

Gear items (`redemption-item` build tree) should gain a `stats` block whose `repeating` adds a
row to the character's weapon/armor section. Target fields (to finalize when built):

- **Weapon** → `repeating_weapons` row: `weaponName`, `weaponMultiplier`, `weaponType`
  (Energy/Kinetic/Melee/Exotic), `weaponScale` (Firefight/Battlefield/Space), `weaponBleed` +
  `weaponBleedType` (Minor/Moderate/Major), `weaponCounters` (text).
- **Armor** → `repeating_armor` row: `armorType`, `armorValue` (Rating) + `armorValueCurr`,
  `armorBody` + `armorBodyCurr`, `armorForceField` + `armorForceFieldCurr`, `armorFFRegen`,
  `armorBodyRegen`, `armorActive` (checkbox; set only if it should be the active armor).

These sections may need sheet tweaks (like the drive fix) before import is complete — TBD.

---

## 6. Design decisions on file (do not re-litigate)

- Gear export carries **both** a `stats` block (sheet-ready, resolved values) **and** the `build`
  tree (for the generator / out-of-Roll20 use). The sheet never re-implements the rules.
- Import mechanism = **sheet Import tab** (worker, no Pro). A Mod-script `!import` is the later
  option for bulk/GM/overwrite.
- Build order: Character → Starship → Weapons/Armor.
