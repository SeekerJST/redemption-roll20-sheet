/* =============================================================================
 * RedemptionBleedRound  -  Roll20 Mod (API) script
 * =============================================================================
 * Start-of-round bleed tick for every combatant at once. Instead of duplicating
 * the sheet's three bleed cascades server-side, this bumps a hidden "bleedTick"
 * attribute on each target character; the SHEET WORKER's Apply handlers listen
 * for change:bleedTick and run their existing Character / Starship / Unit apply
 * logic (each a no-op if that tab has no bleeds). Works even for sheets nobody
 * has open (sheet workers run on attribute change server-side).
 *
 * GM command:
 *   !applybleeds   -> ticks the SELECTED tokens; if none selected, everyone on
 *                     the turn tracker.
 *
 * Only ticks characters whose "Use Automation" toggle is ON (opt-in, matching
 * the missile drain). The manual per-sheet "Apply Regen/Bleeds" button still
 * works for anyone. Set RESPECT_USE_AUTOMATION = false to tick everyone.
 *
 * REQUIRES: Pro (API access) AND the Redemption sheet (which provides the
 * change:bleedTick handlers). Does nothing useful without both.
 * INSTALL: paste into the game's Settings -> API Scripts as a new script.
 * ============================================================================= */

var RedemptionBleedRound = (function () {
    "use strict";

    var RESPECT_USE_AUTOMATION = true;

    function whisperGM(t) { sendChat("Bleed Round", "/w gm " + t); }

    function findAttr(charId, name) {
        var lc = name.toLowerCase();
        return _.find(findObjs({ _type: "attribute", _characterid: charId }), function (a) {
            return (a.get("name") || "").toLowerCase() === lc;
        });
    }

    function automationOn(charId) {
        var a = findAttr(charId, "useAutomation");
        var v = a ? a.get("current") : "";
        return v === "1" || v === "on";
    }

    // selected tokens if any, else the turn tracker
    function targetTokenIds(msg) {
        var ids = [];
        if (msg.selected && msg.selected.length) {
            _.each(msg.selected, function (s) { if (s._type === "graphic") ids.push(s._id); });
            if (ids.length) return ids;
        }
        var to = [];
        try { to = JSON.parse(Campaign().get("turnorder") || "[]"); } catch (e) { to = []; }
        _.each(to, function (t) { if (t.id && t.id !== "-1") ids.push(t.id); });
        return ids;
    }

    // bump the sheet's bleedTick so its change:bleedTick handlers run the round tick
    function tick(charId) {
        var a = findAttr(charId, "bleedTick");
        if (!a) a = createObj("attribute", { characterid: charId, name: "bleedTick", current: "0" });
        a.set("current", String(Date.now()) + "-" + Math.floor(Math.random() * 1000));
    }

    function applyRound(msg) {
        var tokenIds = targetTokenIds(msg);
        if (!tokenIds.length) { whisperGM("No combatants found — select some tokens, or add them to the turn tracker."); return; }

        var seen = {}, ticked = [], skippedAuto = [], noSheet = 0;
        _.each(tokenIds, function (tid) {
            var tok = getObj("graphic", tid);
            if (!tok) return;
            var charId = tok.get("represents");
            if (!charId) { noSheet++; return; }
            if (seen[charId]) return;
            seen[charId] = true;
            var ch = getObj("character", charId);
            var nm = ch ? ch.get("name") : (tok.get("name") || "a token");
            if (RESPECT_USE_AUTOMATION && !automationOn(charId)) { skippedAuto.push(nm); return; }
            tick(charId);
            ticked.push(nm);
        });

        var out = "Bleed round tick — applied to <b>" + ticked.length + "</b> combatant(s)" +
                  (ticked.length ? ": " + ticked.join(", ") : "") + ".";
        if (skippedAuto.length) out += "<br>Skipped " + skippedAuto.length + " (Use Automation off): " + skippedAuto.join(", ") + ".";
        if (noSheet) out += "<br>" + noSheet + " token(s) had no linked character sheet.";
        whisperGM(out);
    }

    return {
        start: function () {
            on("chat:message", function (msg) {
                if (msg.type !== "api") return;
                if (!/^!applybleeds(\b|$)/i.test(msg.content.trim())) return;
                if (!playerIsGM(msg.playerid)) {
                    sendChat("Bleed Round", "/w \"" + msg.who.replace(/ \(GM\)$/, "") + "\" Only the GM can run the bleed round tick.");
                    return;
                }
                applyRound(msg);
            });
            log("RedemptionBleedRound ready. GM: !applybleeds (selected tokens, else the turn tracker; Use-Automation-gated).");
        }
    };
})();

on("ready", function () {
    RedemptionBleedRound.start();
});
