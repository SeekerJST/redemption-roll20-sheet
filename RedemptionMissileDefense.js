/* =============================================================================
 * RedemptionMissileDefense  -  Roll20 Mod (API) script
 * =============================================================================
 * Applies a missile salvo's drain to a targeted ship: the salvo drains the
 * target's Counter Missile Margin (starshipIntercept) FIRST, and any overflow
 * spills into the Defensive margin (DefMargin). Both floor at 0. This mirrors
 * the missile attack card's own "DefMargin + starshipIntercept - salvo" math,
 * so the persisted values match what the card displayed.
 *
 * TRIGGER: the missile attack roll template renders an "Apply Salvo" button:
 *     [Apply Salvo](!missiledrain @{target|Defender|token_id} @{starshipMissileSalvo})
 * At roll time Roll20 bakes in the targeted token's id and the attacker's salvo,
 * so clicking the button sends e.g.  !missiledrain -TokenId123 5
 *
 * PERMISSION: anyone at the table may apply (matches the sheet's collaborative
 * model). Change ANYONE_MAY_APPLY to false to restrict to the GM.
 *
 * REQUIRES: Pro (API access). The sheet works fine without it - the button just
 * won't do anything.
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

    function handleDrain(msg) {
        var m = msg.content.trim().match(/^!missiledrain\s+(\S+)\s+(\d+)\s*$/i);
        if (!m) {
            whisperTo(msg, "Usage: !missiledrain <targetTokenId> <salvo> - normally fired by the 'Apply Salvo' button on a missile attack card.");
            return;
        }
        var tokenId = m[1];
        var salvo = parseInt(m[2]) || 0;

        var token = getObj("graphic", tokenId);
        if (!token) { whisperTo(msg, "Missile drain: target token not found (it may have been deleted, or no token was targeted)."); return; }

        var charId = token.get("represents");
        if (!charId) { whisperTo(msg, "Missile drain: that token isn't linked to a character sheet, so it has no Counter Missile Margin to drain."); return; }
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

        var summary = shipName + " hit by a " + salvo + "-missile salvo. " +
            "Counter Missile Margin " + intercept + " → " + interceptAfter + ". " +
            (overflow > 0
                ? "Overflow " + overflow + " into Defensive margin " + defMargin + " → " + defAfter + "."
                : "Salvo fully absorbed by point defense; Defensive margin unchanged (" + defMargin + ").");
        sendChat("Missile Defense", summary);
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
            log("RedemptionMissileDefense ready. Command: !missiledrain <targetTokenId> <salvo> (fired by the Apply Salvo button).");
        }
    };
})();

on("ready", function () {
    RedemptionMissileDefense.register();
});
