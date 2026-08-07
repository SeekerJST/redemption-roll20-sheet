/* =============================================================================
 * RedemptionScatter  -  Roll20 Mod (API) script
 * =============================================================================
 * Chaos scatter. Every affected token rolls 2d8:
 *   die 1 = direction  (1 N, 2 NE, 3 E, 4 SE, 5 S, 6 SW, 7 W, 8 NW)
 *   die 2 = distance    (squares travelled that way)
 * The token is flung, its Defensive margin is wiped (cover/FF must be
 * re-established at the new position), and if the roll would carry it off the
 * map it BOUNCES: distance +3 and reflect off the wall(s).
 *
 * GM command:
 *   !scatter   -> scatters the SELECTED tokens; if none selected, every token
 *                 on the objects layer of the players' current page.
 *
 * REQUIRES: Pro (API access). GM only.
 * INSTALL: paste into the game's Settings -> API Scripts as a new script.
 * ============================================================================= */

var RedemptionScatter = (function () {
    "use strict";

    var CELL = 70;   // Roll20 grid square = 70px
    var DIRS = {
        1: { x: 0, y: -1, name: "N" },
        2: { x: 1, y: -1, name: "NE" },
        3: { x: 1, y: 0, name: "E" },
        4: { x: 1, y: 1, name: "SE" },
        5: { x: 0, y: 1, name: "S" },
        6: { x: -1, y: 1, name: "SW" },
        7: { x: -1, y: 0, name: "W" },
        8: { x: -1, y: -1, name: "NW" }
    };

    function whisperGM(t) { sendChat("Scatter", "/w gm " + t); }

    function findAttr(charId, name) {
        var lc = name.toLowerCase();
        return _.find(findObjs({ _type: "attribute", _characterid: charId }), function (a) {
            return (a.get("name") || "").toLowerCase() === lc;
        });
    }

    function reflect(v, max) {
        if (v < 0) v = -v; else if (v > max) v = 2 * max - v;
        return Math.max(0, Math.min(max, v));  // clamp if still out after one bounce
    }

    function scatterToken(tok) {
        var page = getObj("page", tok.get("_pageid"));
        if (!page) return null;
        var W = page.get("width") * CELL, H = page.get("height") * CELL;

        var dirRoll = randomInteger(8), distRoll = randomInteger(8);
        var d = DIRS[dirRoll], dist = distRoll;

        var nx = tok.get("left") + d.x * dist * CELL;
        var ny = tok.get("top") + d.y * dist * CELL;

        var bounced = false;
        if (nx < 0 || nx > W || ny < 0 || ny > H) {
            bounced = true;
            dist += 3;                                  // the bounce adds 3
            nx = tok.get("left") + d.x * dist * CELL;
            ny = tok.get("top") + d.y * dist * CELL;
            nx = reflect(nx, W);
            ny = reflect(ny, H);
        }

        tok.set({ left: nx, top: ny });

        // wipe defensive margin - cover/FF must be re-established at the new spot
        var charId = tok.get("represents");
        if (charId) { var a = findAttr(charId, "DefMargin"); if (a) a.set("current", 0); }

        return { name: tok.get("name") || (charId && (getObj("character", charId) || {}).get ? getObj("character", charId).get("name") : "") || "token",
                 dir: d.name, dist: dist, bounced: bounced };
    }

    function targets(msg) {
        var toks = [];
        if (msg.selected && msg.selected.length) {
            _.each(msg.selected, function (s) { if (s._type === "graphic") { var t = getObj("graphic", s._id); if (t) toks.push(t); } });
            if (toks.length) return toks;
        }
        var pageId = Campaign().get("playerpageid");
        return _.filter(findObjs({ _type: "graphic", _pageid: pageId, _subtype: "token", layer: "objects" }), function () { return true; });
    }

    function doScatter(msg) {
        var toks = targets(msg);
        if (!toks.length) { whisperGM("No tokens to scatter — select some, or make sure the players' page has tokens on the objects layer."); return; }

        var lines = [];
        _.each(toks, function (t) {
            var r = scatterToken(t);
            if (r) lines.push("<b>" + r.name + "</b>: " + r.dir + " " + r.dist + (r.bounced ? " (bounced!)" : ""));
        });
        sendChat("Scatter", "/desc the field erupts — everything is flung loose!");
        whisperGM("Scattered <b>" + lines.length + "</b> token(s):<br>" + lines.join("<br>"));
    }

    return {
        start: function () {
            on("chat:message", function (msg) {
                if (msg.type !== "api") return;
                if (!/^!scatter(\b|$)/i.test(msg.content.trim())) return;
                if (!playerIsGM(msg.playerid)) {
                    sendChat("Scatter", "/w \"" + msg.who.replace(/ \(GM\)$/, "") + "\" Only the GM can trigger a scatter.");
                    return;
                }
                doScatter(msg);
            });
            log("RedemptionScatter ready. GM: !scatter (selected tokens, else the players' page).");
        }
    };
})();

on("ready", function () {
    RedemptionScatter.start();
});
