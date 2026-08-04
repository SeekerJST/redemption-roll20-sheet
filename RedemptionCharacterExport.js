/* =============================================================================
 * RedemptionCharacterExport  -  Roll20 Mod (API) script
 * =============================================================================
 * Exports Redemption character sheets to a handout you can copy from.
 *   - Markdown (default): curated, human/AI-readable summary - built for feeding
 *     a planning/GM assistant.
 *   - JSON: full flat-attribute + repeating-row fidelity, structured to round-trip
 *     back into a sheet (the future Phase 4 Export/Import tab / web character
 *     creator). Shape: { name, attributes:{attr:current}, repeating:{section:[{field:current}]} }.
 *
 * GM chat commands:
 *   !exportchars              -> all player-controlled characters, Markdown
 *   !exportchars json         -> all player-controlled characters, JSON
 *   !exportchars <name>       -> one character (PC or NPC; partial name ok), Markdown
 *   !exportchars <name> json  -> one character, JSON
 *
 * Output is written to a handout named "Redemption Character Export" (created or
 * updated), inside a <pre> block. Open it, select all, copy.
 *
 * REQUIRES: Pro (API access). Does nothing without it. GM only.
 * INSTALL: paste into the game's Settings -> API Scripts as a new script.
 * ============================================================================= */

var RedemptionCharacterExport = (function () {
    "use strict";

    var HANDOUT = "Redemption Character Export";

    function whisperGM(t) { sendChat("Character Export", "/w gm " + t); }

    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // case-insensitive flat-attribute lookup (JumpGate preserves case, Legacy lowercases)
    function attrCI(flat, name) {
        var lc = name.toLowerCase();
        for (var k in flat) { if (flat.hasOwnProperty(k) && k.toLowerCase() === lc) return flat[k]; }
        return "";
    }
    function num(flat, name) { var v = parseInt(attrCI(flat, name)); return isNaN(v) ? 0 : v; }

    // { flat:{name:current}, repeating:{section:[{field:current}]} } for a character
    function gather(charId) {
        var flat = {}, rep = {};
        _.each(findObjs({ _type: "attribute", _characterid: charId }), function (a) {
            var n = a.get("name") || "";
            var parts = n.split("_");
            if (parts[0] === "repeating" && parts.length >= 4) {
                var section = parts[1], rowId = parts[2], field = parts.slice(3).join("_");
                if (!rep[section]) rep[section] = {};
                if (!rep[section][rowId]) rep[section][rowId] = {};
                rep[section][rowId][field] = a.get("current");
            } else {
                flat[n] = a.get("current");
            }
        });
        var repArr = {};
        _.each(rep, function (rows, section) { repArr[section] = _.values(rows); });
        return { flat: flat, repeating: repArr };
    }

    function jsonExport(character) {
        var g = gather(character.id);
        return JSON.stringify({ name: character.get("name"), attributes: g.flat, repeating: g.repeating }, null, 2);
    }

    function mdExport(character) {
        var g = gather(character.id), f = g.flat, r = g.repeating;
        var md = "## " + character.get("name") + "\n\n";

        md += "**Concept:** " + (attrCI(f, "Concept") || "—") + " (" + num(f, "ConceptRank") + ")  ";
        md += "**Trouble:** " + (attrCI(f, "Trouble") || "—") + " (" + num(f, "TroubleRank") + ")  ";
        md += "**Race:** " + (attrCI(f, "Race") || "—") + " (" + num(f, "RaceRank") + ")\n\n";

        md += "**Attributes:** " + ["Kinestetic", "Logical", "Interpersonal", "Introspection", "Spatial", "Verbal"]
                .map(function (s) { return s + " " + num(f, s); }).join(" · ") + "\n\n";

        md += "**Body:** " + num(f, "BodyCurr") + "/" + num(f, "BodyMax") +
              "  **Strain:** " + num(f, "StrainCurr") + "/" + num(f, "StrainPermVisible") +
              "  **AP:** " + num(f, "APCount") + "  **Refresh:** " + num(f, "RefreshRating") + "\n\n";

        // "SkillName rank (TN)" — TN is the sheet's computed target number (attr1 + attr2 + rank + mod)
        var skills = [];
        ["grp1", "grp2", "grp3"].forEach(function (p) {
            var name = attrCI(f, p + "SkillName");
            if (name) skills.push(name + " " + num(f, p + "SkillRank") + " (" + num(f, p + "SkillHidden") + ")");
        });
        (r.skills || []).forEach(function (row) {
            if (row.skillName) skills.push(row.skillName + " " + (parseInt(row.skillRank) || 0) + " (" + (parseInt(row.skillHidden) || 0) + ")" + (row.specialty ? " [" + row.specialty + "]" : ""));
        });
        md += "**Skills:** " + (skills.length ? skills.join(", ") : "—") + "\n\n";

        md += "**Tags:**\n";
        var tags = r.tags || [];
        if (!tags.length) md += "- —\n";
        tags.forEach(function (row) {
            md += "- " + (row.tagText || "(unnamed)") + " " + (parseInt(row.tagRank) || 0) + (row.tagType ? " · " + row.tagType : "") + "\n";
        });
        md += "\n";

        md += "**Armor:**\n";
        var armor = r.armor || [];
        if (!armor.length) md += "- —\n";
        armor.forEach(function (row) {
            var active = (row.armorActive === "on" || row.armorActive === "1") ? " (active)" : "";
            md += "- " + (row.armorName || "(unnamed)") + active + " — " + (row.armorType || "") +
                  "; Rating " + (parseInt(row.armorValueCurr) || 0) + "/" + (parseInt(row.armorValue) || 0) +
                  ", Body " + (parseInt(row.armorBodyCurr) || 0) + "/" + (parseInt(row.armorBody) || 0) +
                  ", FF " + (parseInt(row.armorForceFieldCurr) || 0) + "/" + (parseInt(row.armorForceField) || 0);
            var ffr = parseInt(row.armorFFRegen) || 0, bpr = parseInt(row.armorBodyRegen) || 0;
            if (ffr || bpr) md += " (regen FF " + ffr + " / Body " + bpr + ")";
            md += "\n";
        });
        md += "\n";

        md += "**Weapons:**\n";
        var weapons = r.weapons || [];
        if (!weapons.length) md += "- —\n";
        weapons.forEach(function (row) {
            md += "- " + (row.weaponName || "(unnamed)") + " — ×" + (parseInt(row.weaponMultiplier) || 1) +
                  " " + (row.weaponType || "") + (row.weaponScale ? " / " + row.weaponScale : "") +
                  (parseInt(row.weaponBleed) ? " · bleed " + row.weaponBleed : "") + "\n";
        });
        md += "\n";

        var eq = [];
        ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"].forEach(function (w) {
            var name = attrCI(f, "EquipmentList" + w);
            if (name) eq.push(name);
        });
        md += "**Equipment:** " + (eq.length ? eq.join(", ") : "—") + "\n\n";

        return md;
    }

    // A PC is controlled by at least one specific PLAYER. Exclude GM-only ("") and, importantly,
    // characters controlled ONLY by "all" (a common NPC setup so token health/FF bars show to players).
    function isPC(character) {
        var cb = (character.get("controlledby") || "").trim();
        if (cb === "") return false;
        return cb.split(",").some(function (id) { id = id.trim(); return id !== "" && id !== "all"; });
    }

    function writeHandout(body) {
        var h = findObjs({ _type: "handout", name: HANDOUT })[0];
        if (!h) h = createObj("handout", { name: HANDOUT });
        var content = "<pre style=\"white-space:pre-wrap;\">" + esc(body) + "</pre>";
        h.set("notes", content);
        h.set("gmnotes", content);
    }

    function doExport(msg) {
        var arg = msg.content.replace(/^!exportchars\s*/i, "").trim();
        var format = "md";
        var m = arg.match(/\s*(json|md|markdown)\s*$/i);
        if (m) { format = /json/i.test(m[1]) ? "json" : "md"; arg = arg.slice(0, m.index).trim(); }

        var targets;
        if (arg === "") {
            targets = _.filter(findObjs({ _type: "character" }), isPC);
            if (!targets.length) { whisperGM("No player-controlled characters found. Name one explicitly, e.g. <code>!exportchars Gethin</code>."); return; }
        } else {
            var lc = arg.toLowerCase();
            targets = _.filter(findObjs({ _type: "character" }), function (c) { return (c.get("name") || "").toLowerCase().indexOf(lc) !== -1; });
            if (!targets.length) { whisperGM("No character matched \"" + esc(arg) + "\"."); return; }
        }

        var body;
        if (format === "json") {
            body = (targets.length === 1) ? jsonExport(targets[0]) : "[\n" + targets.map(jsonExport).join(",\n") + "\n]";
        } else {
            body = "# Redemption character export (" + targets.length + ")\n\n" + targets.map(mdExport).join("\n---\n\n");
        }

        writeHandout(body);
        whisperGM("Exported <b>" + targets.length + "</b> character(s) as <b>" + format.toUpperCase() +
                  "</b> to the handout <b>&quot;" + HANDOUT + "&quot;</b> — open it, select all, copy.");
    }

    return {
        start: function () {
            on("chat:message", function (msg) {
                if (msg.type !== "api") return;
                if (!/^!exportchars(\b|$)/i.test(msg.content.trim())) return;
                if (!playerIsGM(msg.playerid)) {
                    sendChat("Character Export", "/w \"" + msg.who.replace(/ \(GM\)$/, "") + "\" Only the GM can export characters.");
                    return;
                }
                doExport(msg);
            });
            log("RedemptionCharacterExport ready. GM: !exportchars [name] [json|md]");
        }
    };
})();

on("ready", function () {
    RedemptionCharacterExport.start();
});
