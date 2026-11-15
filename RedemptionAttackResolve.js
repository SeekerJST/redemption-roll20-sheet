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
 *
 *   WHICH DEFENSE: the attack card carries {{scale=...}}. Space scale resolves
 *   against the defender's STARSHIP defense (starshipForceFieldCurr / starshipHull);
 *   any other scale uses the PERSONAL active-armor mirrors (armorActiveFF /
 *   armorActiveRating, maintained by the sheet worker). DefMargin is shared.
 *
 *   Force Field UP (ff > 0): the hit lands on the FF at FULL FORCE - the target's
 *     Rating/Hull is IGNORED and the FF does NOT spill to Body.
 *       damage = net * max(1, weaponMultiplier [+2 if the weapon Counters Force Field])
 *   No Force Field: Rating/Hull reduces the multiplier (floored at 1).
 *       damage = net * max(1, weaponMultiplier - max(0, Rating [-1 if the weapon Counters Armor]))
 *
 *   COUNTERS: the weapon's free-text Counters field ({{counters=...}} on the card,
 *   e.g. "Force Field", "Armor", "Force Field, Armor") is rank-1 flat: Counter
 *   Force Field = +2 to the multiplier when the target's FF is up; Counter Armor =
 *   -1 to the target's effective Rating/Hull. (Aimed-Shot's extra Counter-Armor
 *   pick needs a roll/resolve-time toggle - still a later pass.)
 *
 *   Damage is DISPLAYED only - the attacker/GM applies it (keeps the damage-OR-tag
 *   choice manual).
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
    var SHIP_FF   = "starshipForceFieldCurr"; // ship defender: current Force Field
    var SHIP_HULL = "starshipHull";           // ship defender: Hull Rating (ship "armor")
    var COUNTER_FF_BONUS   = 2;               // Counter Force Field: + to multiplier when the target's FF is up
    var COUNTER_ARMOR_STEP = 1;               // Counter Armor: - to the target's effective Rating/Hull, per source
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

    // Parse the weapon's free-text Counters field. Rank is always 1, so these are booleans:
    //   "Force Field" / "Shields" -> counters a force field ; "Armor" -> counters armor Rating/Hull.
    function parseCounters(text) {
        var t = (text || "");
        return {
            ff:    /force\s*field|shield/i.test(t),
            armor: /armou?r/i.test(t)
        };
    }

    // resolve a cached attack (info = {margin, mult, scale, counters}) vs the selected defender
    function resolve(info, attackerId, msg) {
        info = info || {};
        var margin     = info.margin;
        var multiplier = info.mult;
        if (isNaN(margin))     { whisperTo(msg, "Attack resolve: no valid margin cached - roll the attack again."); return; }
        if (isNaN(multiplier)) multiplier = 1;

        var isSpace  = ((info.scale || "").toLowerCase() === "space");  // Space scale -> ship defender
        var counters = parseCounters(info.counters);

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

        // net > 0 -> HIT. Space scale reads the ship's FF/Hull; otherwise personal active-armor mirrors.
        var ff     = isSpace ? readNum(defId, SHIP_FF)   : readNum(defId, FF);
        var rating = isSpace ? readNum(defId, SHIP_HULL) : readNum(defId, RATING);
        var ratingLabel = isSpace ? "Hull" : "armor Rating";
        var factor, note;
        if (ff > 0) {
            // FF up: hit lands on the Force Field at full force, Rating/Hull ignored, no spillover to Body.
            // A Counter-Force-Field weapon raises the multiplier by COUNTER_FF_BONUS.
            var ffBonus = counters.ff ? COUNTER_FF_BONUS : 0;
            factor = Math.max(1, multiplier + ffBonus);
            note = "hits Force Field (" + ff + ") at full force" +
                   (ffBonus ? ", counter-FF +" + ffBonus + " to multiplier" : ", " + ratingLabel + " ignored") +
                   ", no spillover to Body";
        } else {
            // No FF: Rating/Hull reduces the multiplier. A Counter-Armor weapon lowers the effective Rating by COUNTER_ARMOR_STEP.
            var armorCut  = counters.armor ? COUNTER_ARMOR_STEP : 0;
            var effRating = Math.max(0, rating - armorCut);
            factor = Math.max(1, multiplier - effRating);
            if (rating > 0) {
                note = ratingLabel + " " + rating +
                       (armorCut ? " minus counter-armor " + armorCut + " = " + effRating : "") + " applied";
            } else {
                note = "no " + (isSpace ? "Hull" : "armor");
            }
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

        var scale = "", sm = msg.content.match(/\{\{scale=([^}]*)\}\}/);
        if (sm) scale = sm[1].trim();

        var counters = "", cm = msg.content.match(/\{\{counters=([^}]*)\}\}/);
        if (cm) counters = cm[1].trim();

        var atk = "", am = msg.content.match(/\{\{attacker=([^}]*)\}\}/);
        if (am) atk = am[1].trim();

        var info = { margin: margin, mult: mult, scale: scale, counters: counters };
        if (atk) lastAttack[atk] = info;

        // one-step: a defender already selected at roll time -> resolve immediately
        if (msg.selected && msg.selected.length) resolve(info, atk, msg);
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
        resolve(last, atk, msg);
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
