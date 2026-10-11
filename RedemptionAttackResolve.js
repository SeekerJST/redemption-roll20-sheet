/* =============================================================================
 * RedemptionAttackResolve  -  Roll20 Mod (API) script
 * =============================================================================
 * Resolves a Redemption attack against the DEFENDER by SELECTION instead of
 * @{target}. This exists because the Roll20 target picker decays at a live
 * table: "Choose Target" appears but the canvas click never resolves (silent,
 * no error), and EVERY @{target} route - roll-template inline AND API-button
 * (confirmed: "Apply Salvo" freezes the same way) - rides that one dead picker.
 * Normal token SELECTION keeps working, so resolution moves onto msg.selected.
 *
 * HOW THE MARGIN REACHES THE SCRIPT (and why no $[[0]]):
 *   The attack card can't pass the rolled margin through the button - $[[0]] in
 *   an API button inside a roll template expands to the inline-roll DISPLAY HTML,
 *   not a bare number, so !attackvs got a chunk of markup and the parse failed.
 *   Instead this script watches every attack roll (they carry {{attackverdict=1}}
 *   {{attacker=<charId>}} and a single inline roll = the margin) and CACHES that
 *   attacker's latest margin + multiplier. Resolution then uses the cache.
 *
 * TWO WAYS TO RESOLVE (both read the selected defender):
 *   1. One-step: SELECT the defender token, then click the weapon's attack
 *      button. If the roll carries your selection, it resolves immediately.
 *   2. Button:   roll first, then SELECT the defender and click the card's
 *      "Resolve vs Selected" button -> !attackvs <attackerCharId>. Resolves the
 *      attacker's cached latest margin vs whatever the clicker has selected, so
 *      the GM can resolve a player's attack by selecting the defender themselves.
 *
 * RULES (regular attacks; Aimed Shots / auto-apply are a later pass):
 *   net = margin - DefMargin
 *   net  < 0  -> MISS
 *   net == 0  -> MEET: success, no damage, may apply a tag
 *   net  > 0  -> HIT:  damage, OR apply a tag instead (attacker's choice)
 *   Force Field UP (armorActiveFF > 0): the hit lands on the FF at FULL FORCE -
 *     target armor Rating is IGNORED, and depleting the FF does NOT spill to Body.
 *       damage = net * max(1, weaponMultiplier)
 *   No Force Field: armor Rating reduces the multiplier (floored at 1).
 *       damage = net * max(1, weaponMultiplier - armorActiveRating)
 *   Damage is DISPLAYED only - the attacker/GM applies it (keeps the damage-OR-tag
 *   choice manual). armorActiveFF / armorActiveRating are the active-armor mirrors
 *   maintained by the sheet worker.
 *
 * PERMISSION: anyone may resolve (matches the sheet's collaborative model). Set
 * ANYONE_MAY_RESOLVE = false for GM only.
 *
 * REQUIRES: Pro (API access) + "Use Automation" ON (reveals the button). The
 * sheet works fine without it - attacks just won't auto-resolve.
 *
 * ENGINE NOTE: Legacy lowercases attribute names server-side; JumpGate preserves
 * the authored case. Attributes are matched CASE-INSENSITIVELY.
 *
 * INSTALL: paste into the game's Settings -> API Scripts as a new script.
 * ============================================================================= */

var RedemptionAttackResolve = (function () {
    "use strict";

    var DEFMARGIN = "DefMargin";              // sheet label: "Defensive margin"
    var FF        = "armorActiveFF";          // active armor's current Force Field (mirror)
    var RATING    = "armorActiveRating";      // active armor's Rating (mirror)
    var ANYONE_MAY_RESOLVE = true;            // false = GM only

    // attackerCharId -> { margin, mult } ; the attacker's most recent attack roll
    var lastAttack = {};

    function whisperTo(msg, text) {
        var who = (msg && msg.who) ? msg.who.replace(/ \(GM\)$/, "") : "gm";
        sendChat("Attack", "/w \"" + who + "\" " + text);
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

    // resolve a known margin + multiplier (from the cache) vs the selected defender
    function resolve(margin, multiplier, attackerId, msg) {
        if (isNaN(margin))     { whisperTo(msg, "Attack resolve: no valid margin cached - roll the attack again."); return; }
        if (isNaN(multiplier)) multiplier = 1;

        var defToken = firstSelectedGraphic(msg);
        if (!defToken) {
            whisperTo(msg, "Select the DEFENDER token, then click \"Resolve vs Selected\" (or roll with the defender selected to resolve in one step).");
            return;
        }
        var defId = defToken.get("represents");
        if (!defId) { whisperTo(msg, "That token isn't linked to a character sheet, so it has no Defensive margin."); return; }
        if (attackerId && defId === attackerId) {
            whisperTo(msg, "That's the attacker's own token - select the DEFENDER token, then resolve.");
            return;
        }

        var defChar = getObj("character", defId);
        var defName = defChar ? defChar.get("name") : (defToken.get("name") || "the target");
        var atkName = "Attacker";
        if (attackerId) { var ac = getObj("character", attackerId); if (ac) atkName = ac.get("name"); }

        var defMargin = readNum(defId, DEFMARGIN);
        var net = margin - defMargin;
        var title = atkName + " vs " + defName;

        // post the verdict as a styled &{template:redemption} card (same template as attack rolls).
        // NB: no {{attackverdict=1}} here, so the auto-path never re-processes our own output.
        function card(verdict, detail) {
            sendChat("Attack", "&{template:redemption}{{title=" + title + "}}{{roll=" + verdict + "}}{{result=" + detail + "}}");
        }

        if (net < 0) {
            card("MISS", "margin " + margin + " vs Def " + defMargin + " - short by " + (-net) + ".");
            return;
        }
        if (net === 0) {
            card("MEET", "margin " + margin + " = Def " + defMargin + " - success, no damage. May apply a tag.");
            return;
        }

        // net > 0 -> HIT
        var ff     = readNum(defId, FF);
        var rating = readNum(defId, RATING);
        var factor, note;
        if (ff > 0) {
            factor = Math.max(1, multiplier);
            note = "hits Force Field (" + ff + ") at full force - armor Rating ignored, no spillover to Body";
        } else {
            factor = Math.max(1, multiplier - rating);
            note = (rating > 0 ? "armor Rating " + rating + " applied" : "no armor");
        }
        var dmg = net * factor;
        card("HIT - " + dmg + " dmg", "margin " + margin + " vs Def " + defMargin + " (net +" + net + ") - " + note + ". Or apply a tag instead.");
    }

    // every attack roll: cache this attacker's margin+mult, and resolve now if a defender is selected
    function cacheAndMaybeResolve(msg) {
        if (!msg.inlinerolls || !msg.inlinerolls.length) return;
        var margin = parseInt(msg.inlinerolls[0].results.total);
        if (isNaN(margin)) return;

        var mult = 1, mm = msg.content.match(/\{\{damage=(-?\d+)\}\}/);
        if (mm) mult = parseInt(mm[1]);

        var atk = "", am = msg.content.match(/\{\{attacker=([^}]*)\}\}/);
        if (am) atk = am[1].trim();

        if (atk) lastAttack[atk] = { margin: margin, mult: mult };

        // one-step: a defender already selected at roll time -> resolve immediately
        if (msg.selected && msg.selected.length) resolve(margin, mult, atk, msg);
    }

    // the "Resolve vs Selected" button: !attackvs <attackerCharId>
    // (take the LAST token as the id, so it's robust to any extra args)
    function handleButton(msg) {
        var toks = msg.content.trim().split(/\s+/);
        var atk = (toks.length > 1) ? toks[toks.length - 1] : "";
        var last = atk ? lastAttack[atk] : null;
        if (!atk || !last) {
            whisperTo(msg, "No recent attack found to resolve. Roll the attack first, then SELECT the defender token and click \"Resolve vs Selected\".");
            return;
        }
        resolve(last.margin, last.mult, atk, msg);
    }

    return {
        register: function () {
            on("chat:message", function (msg) {
                var content = (msg.content || "").trim();

                if (msg.type === "api" && /^!attackvs(\b|$)/i.test(content)) {
                    if (!ANYONE_MAY_RESOLVE && !playerIsGM(msg.playerid)) {
                        whisperTo(msg, "Only the GM can resolve attacks.");
                        return;
                    }
                    handleButton(msg);
                    return;
                }

                // a Redemption attack roll template carrying the verdict marker
                if (msg.rolltemplate === "redemption" && /\{\{attackverdict=1\}\}/.test(content)) {
                    if (!ANYONE_MAY_RESOLVE && !playerIsGM(msg.playerid)) return;
                    cacheAndMaybeResolve(msg);
                    return;
                }
            });
            log("RedemptionAttackResolve ready. Roll with the defender selected, or click 'Resolve vs Selected' (!attackvs) after selecting.");
        }
    };
})();

on("ready", function () {
    RedemptionAttackResolve.register();
});
