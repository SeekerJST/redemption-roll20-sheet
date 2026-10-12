/* =============================================================================
 * RedemptionMissileDefense  -  Roll20 Mod (API) script
 * =============================================================================
 * Applies a missile salvo's drain to the SELECTED target ship: the salvo drains
 * the target's Counter Missile Margin (starshipIntercept) FIRST, and any overflow
 * spills into the Defensive margin (DefMargin). Both floor at 0. This mirrors the
 * missile attack card's own "DefMargin + starshipIntercept - salvo" math, so the
 * persisted values match the intent.
 *
 * TARGETING BY SELECTION (not @{target}): the Roll20 target picker decays at a
 * live table (silent dead canvas click - every @{target} route including the old
 * @{target|token_id} Apply Salvo button freezes), while normal token SELECTION
 * keeps working. So the Apply Salvo button no longer embeds a target; the applier
 * SELECTS the defending ship token and clicks the button.
 *
 * TRIGGER: the missile attack roll template renders an "Apply Salvo vs Selected"
 * button:
 *     [Apply Salvo vs Selected](!missiledrain @{starshipMissileSalvo} @{character_id})
 * At roll time Roll20 bakes in the attacker's salvo and the attacker's own
 * character id (used only to refuse draining your own ship). Clicking it sends
 * e.g.  !missiledrain 5 -AttackerCharId  with the defender ship SELECTED.
 *
 * PERMISSION: anyone at the table may apply (matches the sheet's collaborative
 * model). Change ANYONE_MAY_APPLY to false to restrict to the GM.
 *
 * REQUIRES: Pro (API access) + "Use Automation" ON (reveals the button). The
 * sheet works fine without it - the button just won't do anything.
 *
 * ENGINE NOTE: Legacy lowercases attribute names server-side; JumpGate preserves
 * the authored case. So attributes are matched CASE-INSENSITIVELY, and writes
 * reuse the found attribute's exact name (falling back to the authored name only
 * when the attribute doesn't exist yet).
 *
 * INSTALL: paste into the game's Settings -> API Scripts as a new script.
 * ============================================================================= */

var RedemptionMissileDefense = (function () {
    "use strict";

    var INTERCEPT = "starshipIntercept";   // sheet label: "Counter Missile Margin"
    var DEFMARGIN = "DefMargin";            // sheet label: "Defensive margin"
    var ANYONE_MAY_APPLY = true;            // false = GM only

    function whisperTo(msg, text) {
        var who = (msg && msg.who) ? msg.who.replace(/ \(GM\)$/, "") : "gm";
        sendChat("Missile Defense", "/w \"" + who + "\" " + text);
    }

    // case-insensitive attribute lookup (JumpGate preserves case, Legacy lowercases)
    function findAttr(charId, name) {
        var lc = name.toLowerCase();
        return _.find(findObjs({ _type: "attribute", _characterid: charId }), function (a) {
            return (a.get("name") || "").toLowerCase() === lc;
        });
    }

    function readNum(charId, name) {
        var a = findAttr(charId, name);
        return a ? (parseInt(a.get("current")) || 0) : 0;
    }

    // write value, preserving the existing attribute's exact name; create with the
    // authored name if it doesn't exist yet
    function writeNum(charId, authoredName, value) {
        var a = findAttr(charId, authoredName);
        if (a) {
            a.set("current", value);
        } else {
            createObj("attribute", { characterid: charId, name: authoredName, current: value });
        }
    }

    // first selected token that is a graphic on the tabletop
    function firstSelectedGraphic(msg) {
        if (!msg.selected || !msg.selected.length) return null;
        for (var i = 0; i < msg.selected.length; i++) {
            if (msg.selected[i]._type === "graphic") {
                var t = getObj("graphic", msg.selected[i]._id);
                if (t) return t;
            }
        }
        return null;
    }

    function handleDrain(msg) {
        // !missiledrain <salvo> [attackerCharId]
        var m = msg.content.trim().match(/^!missiledrain\s+(\d+)(?:\s+(\S+))?\s*$/i);
        if (!m) {
            whisperTo(msg, "Usage: !missiledrain <salvo> - normally fired by the 'Apply Salvo vs Selected' button; SELECT the defending ship first.");
            return;
        }
        var salvo = parseInt(m[1]) || 0;
        var attackerId = m[2] || "";

        var token = firstSelectedGraphic(msg);
        if (!token) { whisperTo(msg, "Missile drain: SELECT the defending ship token, then click 'Apply Salvo vs Selected'."); return; }

        var charId = token.get("represents");
        if (!charId) { whisperTo(msg, "Missile drain: that token isn't linked to a character sheet, so it has no Counter Missile Margin to drain."); return; }
        if (attackerId && charId === attackerId) { whisperTo(msg, "Missile drain: that's the attacker's own ship - SELECT the DEFENDING ship, then apply."); return; }

        var character = getObj("character", charId);
        var shipName = character ? character.get("name") : (token.get("name") || "the target");

        if (salvo <= 0) { whisperTo(msg, "Missile drain: salvo size is 0 - nothing to apply to " + shipName + "."); return; }

        var intercept = readNum(charId, INTERCEPT);
        var defMargin = readNum(charId, DEFMARGIN);

        // salvo drains Counter Missile Margin first; the overflow spills into Defensive margin
        var interceptAfter = intercept - salvo;
        var overflow = 0;
        if (interceptAfter < 0) { overflow = -interceptAfter; interceptAfter = 0; }
        var defAfter = defMargin - overflow;
        if (defAfter < 0) defAfter = 0;

        writeNum(charId, INTERCEPT, interceptAfter);
        if (overflow > 0) writeNum(charId, DEFMARGIN, defAfter);

        var detail = "Counter Missile Margin " + intercept + " -> " + interceptAfter +
            (overflow > 0
                ? "; overflow " + overflow + " into Defensive margin " + defMargin + " -> " + defAfter + "."
                : "; salvo fully absorbed by point defense (Defensive margin " + defMargin + " unchanged).");

        // styled &{template:redemption} card, matching the attack resolver's output
        sendChat("Missile Defense", "&{template:redemption}{{title=" + shipName + "}}{{roll=" + salvo + "-missile salvo}}{{result=" + detail + "}}");
    }

    return {
        register: function () {
            on("chat:message", function (msg) {
                if (msg.type !== "api") return;
                if (!/^!missiledrain(\b|$)/i.test(msg.content.trim())) return;
                if (!ANYONE_MAY_APPLY && !playerIsGM(msg.playerid)) {
                    whisperTo(msg, "Only the GM can apply a missile salvo drain.");
                    return;
                }
                handleDrain(msg);
            });
            log("RedemptionMissileDefense ready. Command: !missiledrain <salvo> (fired by the 'Apply Salvo vs Selected' button; select the defending ship first).");
        }
    };
})();

on("ready", function () {
    RedemptionMissileDefense.register();
});
