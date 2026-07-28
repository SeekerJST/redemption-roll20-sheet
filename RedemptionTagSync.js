/* =============================================================================
 * RedemptionTagSync  -  Roll20 Mod (API) script
 * =============================================================================
 * Keeps the shared Tag Journal (repeating_tagJournal) IDENTITY fields
 * (tagText / tagRank / tagType) in sync across every character in the game,
 * while leaving each character's own invoke/condemn (tagUse) and locked
 * (tagStatus) choices untouched.
 *
 * MODEL: one sheet is the "master" (its Tag Journal "Master Journal" switch is
 * on). Editing the master's Journal propagates the tag list to all other
 * characters. Turning the switch on anywhere turns it off everywhere else.
 * GM-only chat commands:
 *   !tagsync              force-push from the current master (always replies)
 *   !tagsync verbose on   log every automatic sync to the API console
 *   !tagsync verbose off  stay quiet on automatic syncs (DEFAULT)
 *   !tagsync verbose      toggle the above
 *   !tagsync debug        dump what the sandbox actually sees (always replies)
 * Verbose defaults OFF and persists in state across restarts.
 *
 * REQUIRES: Pro (API access). The character sheet works fine WITHOUT this
 * script - it just won't sync between characters.
 *
 * ENGINE NOTE: Legacy lowercases attribute names server-side; JumpGate
 * PRESERVES the authored case (confirmed 2026-07-19: the switch attribute is
 * literally "tagJournalMaster"). So this script matches every attribute name
 * CASE-INSENSITIVELY, and when it writes to other sheets it mirrors the
 * master's exact attribute-name string rather than rebuilding it - that way it
 * is correct on both engines regardless of casing.
 *
 * INSTALL: paste into the game's Settings -> API Scripts as a new script.
 * ============================================================================= */

var RedemptionTagSync = (function () {
    "use strict";

    // lowercase canonical forms - all name matching is done case-insensitively
    var SECTION_LC = "repeating_tagjournal";
    var IDENTITY_LC = ["tagtext", "tagrank", "tagtype"];    // synced from master
    var PERSONAL_LC = ["taguse", "tagstatus"];              // left per-character
    var ALLFIELDS_LC = IDENTITY_LC.concat(PERSONAL_LC);
    var MASTER_ATTR_LC = "tagjournalmaster";                // the per-sheet switch
    var REPORDER_LC = "_reporder_" + SECTION_LC;
    var ROW_RE = new RegExp("^" + SECTION_LC + "_(.+)_(" + ALLFIELDS_LC.join("|") + ")$", "i");
    // authored-case fallback, only used to create a reporder attr from scratch
    var REPORDER_AUTHORED = "_reporder_repeating_tagJournal";

    var syncTimer = null;

    /* ---- state ---------------------------------------------------------- */
    function initState() {
        if (!state.RedemptionTagSync) state.RedemptionTagSync = { masterId: null, verbose: false };
        if (state.RedemptionTagSync.verbose === undefined) state.RedemptionTagSync.verbose = false;
    }
    function verbose() { return !!state.RedemptionTagSync.verbose; }

    /* ---- helpers -------------------------------------------------------- */

    function isMasterAttr(name) { return (name || "").toLowerCase() === MASTER_ATTR_LC; }
    function isReporder(name) { return (name || "").toLowerCase() === REPORDER_LC; }
    function isSwitchOn(attr) { var v = attr.get("current"); return v === "1" || v === "on"; }

    // { attrName: attrObj } for every repeating_tagjournal attribute of a character
    // (plus the section's _reporder_ attribute, used to mirror row order)
    function journalAttrs(charId) {
        var map = {};
        _.each(findObjs({ _type: "attribute", _characterid: charId }), function (a) {
            var n = a.get("name") || "";
            var nl = n.toLowerCase();
            if (nl.indexOf(SECTION_LC + "_") === 0 || nl === REPORDER_LC) map[n] = a;
        });
        return map;
    }

    // { rowId: { fieldLC: attrObj } } - keeps the real attr objects so we can
    // read their current value AND reuse their exact authored name when writing
    function parseRowAttrs(attrMap) {
        var rows = {};
        _.each(attrMap, function (attr, name) {
            var m = name.match(ROW_RE);
            if (m) {
                var id = m[1], field = m[2].toLowerCase();
                if (!rows[id]) rows[id] = {};
                rows[id][field] = attr;
            }
        });
        return rows;
    }

    function reporderAttr(attrMap) {
        return _.find(attrMap, function (a) { return isReporder(a.get("name")); });
    }

    function getMaster() {
        var id = state.RedemptionTagSync.masterId;
        return id ? getObj("character", id) : null;
    }

    function whisperGM(text) {
        sendChat("Tag Journal", "/w gm " + text);
    }

    /* ---- diagnostics ---------------------------------------------------- */
    // !tagsync debug  -> dump what the server actually sees, so we can tell
    // whether the sheet's attributes are reaching the API sandbox and under
    // what name/value (JumpGate vs Legacy casing has surprised us here).
    function debugDump() {
        var chars = findObjs({ _type: "character" });
        var lines = ["<b>Tag Journal debug</b> — masterId = " + (state.RedemptionTagSync.masterId || "none")];
        _.each(chars, function (c) {
            var msw = _.find(findObjs({ _type: "attribute", _characterid: c.id }), function (a) { return isMasterAttr(a.get("name")); });
            var rows = _.keys(parseRowAttrs(journalAttrs(c.id))).length;
            lines.push(c.get("name") + " [" + c.id + "]  master=" +
                (msw ? JSON.stringify(msw.get("current")) : "(no attr)") + "  journalRows=" + rows);
        });
        log("RedemptionTagSync DEBUG: " + lines.join(" | "));
        whisperGM(lines.join("<br>"));
    }

    /* ---- the sync ------------------------------------------------------- */

    function syncFromMaster() {
        var master = getMaster();
        if (!master) return { ok: false, msg: "No master Tag Journal is set. Turn on the 'Master Journal' switch on one sheet." };

        var masterMap = journalAttrs(master.id);
        var masterRows = parseRowAttrs(masterMap);
        var masterIds = _.keys(masterRows);

        // preserve the master's row order for the other sheets
        var orderAttr = reporderAttr(masterMap);
        var order = orderAttr ? orderAttr.get("current") : masterIds.join(",");

        var targets = _.filter(findObjs({ _type: "character" }), function (c) { return c.id !== master.id; });

        _.each(targets, function (char) {
            var attrMap = journalAttrs(char.id);
            var charRows = parseRowAttrs(attrMap);

            // upsert the identity fields for every master row (leave taguse/tagstatus alone).
            // Reuse the master attribute's EXACT name string so casing matches the sheet.
            _.each(masterIds, function (rowId) {
                _.each(IDENTITY_LC, function (fieldLC) {
                    var mAttr = masterRows[rowId][fieldLC];
                    if (!mAttr) return;
                    var name = mAttr.get("name");
                    var val = mAttr.get("current");
                    var existing = charRows[rowId] && charRows[rowId][fieldLC];
                    if (existing) {
                        if (existing.get("current") !== val) existing.set("current", val);
                    } else {
                        createObj("attribute", { characterid: char.id, name: name, current: val });
                    }
                });
            });

            // remove any rows this character has that the master no longer has
            // (drops the personal fields too - the tag is gone from the scene)
            _.each(_.keys(charRows), function (rowId) {
                if (!_.contains(masterIds, rowId)) {
                    _.each(charRows[rowId], function (attr) { attr.remove(); });
                }
            });

            // mirror row order
            var ro = reporderAttr(attrMap);
            if (ro) {
                if (ro.get("current") !== order) ro.set("current", order);
            } else {
                var roName = orderAttr ? orderAttr.get("name") : REPORDER_AUTHORED;
                createObj("attribute", { characterid: char.id, name: roName, current: order });
            }
        });

        return { ok: true, msg: "Synced " + masterIds.length + " tag(s) from " + master.get("name") + " to " + targets.length + " character(s)." };
    }

    function scheduleSync() {
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(function () {
            syncTimer = null;
            var r = syncFromMaster();
            if (verbose()) log("RedemptionTagSync: " + r.msg);
        }, 400);
    }

    /* ---- master switch exclusivity ------------------------------------- */

    function onMasterSwitch(obj) {
        var charId = obj.get("_characterid");

        if (isSwitchOn(obj)) {
            state.RedemptionTagSync.masterId = charId;
            // turn the switch OFF on every other character (fires change events,
            // but the "off" branch is a no-op, so no loop)
            _.each(findObjs({ _type: "attribute" }), function (a) {
                if (!isMasterAttr(a.get("name"))) return;
                if (a.get("_characterid") !== charId && a.get("current") !== "0") a.set("current", "0");
            });
            var c = getObj("character", charId);
            whisperGM((c ? c.get("name") : "A sheet") + " is now the master Tag Journal.");
            scheduleSync();
        } else {
            // if the current master turned itself off, there is no master anymore
            if (charId === state.RedemptionTagSync.masterId) {
                state.RedemptionTagSync.masterId = null;
                whisperGM("Master Tag Journal switched off - no master is set. Other sheets keep their current tags.");
            }
        }
    }

    /* ---- event wiring --------------------------------------------------- */

    function registerHandlers() {
        // NOTE: Roll20 fires "change:attribute" only for attributes that already
        // exist. The FIRST time a checkbox/field is touched the attribute is
        // created, which fires "add:attribute" instead. Both must be handled -
        // otherwise the very first Master-switch toggle (and any brand-new tag
        // row) is invisible to the script.
        var onAttr = function (obj) {
            var name = obj.get("name");
            if (isMasterAttr(name)) { onMasterSwitch(obj); return; }
            // an IDENTITY edit/add on the master sheet triggers a sync
            var m = name.match(ROW_RE);
            if (m && _.contains(IDENTITY_LC, m[2].toLowerCase()) && obj.get("_characterid") === state.RedemptionTagSync.masterId) {
                scheduleSync();
            }
        };
        on("change:attribute", onAttr);
        on("add:attribute", onAttr);

        // a whole row being removed on the master also needs a resync
        on("destroy:attribute", function (obj) {
            var name = obj.get("name");
            var m = name.match(ROW_RE);
            if (m && obj.get("_characterid") === state.RedemptionTagSync.masterId) scheduleSync();
        });

        // if the master character is deleted, clear the master
        on("destroy:character", function (obj) {
            if (obj.id === state.RedemptionTagSync.masterId) {
                state.RedemptionTagSync.masterId = null;
                whisperGM("The master Tag Journal character was removed - no master is set.");
            }
        });

        on("chat:message", function (msg) {
            if (msg.type !== "api") return;
            if (!/^!tagsync(\b|$)/i.test(msg.content.trim())) return;
            if (!playerIsGM(msg.playerid)) {
                sendChat("Tag Journal", "/w \"" + msg.who.replace(/ \(GM\)$/, "") + "\" Only the GM can force a Tag Journal sync.");
                return;
            }
            var content = msg.content.trim();
            if (/^!tagsync\s+debug\b/i.test(content)) { debugDump(); return; }
            var vm = content.match(/^!tagsync\s+verbose(?:\s+(on|off))?\s*$/i);
            if (vm) {
                var want = vm[1] ? (vm[1].toLowerCase() === "on") : !verbose(); // no arg = toggle
                state.RedemptionTagSync.verbose = want;
                whisperGM("Tag Journal sync: verbose logging is now <b>" + (want ? "ON" : "OFF") + "</b>.");
                return;
            }
            var r = syncFromMaster();
            whisperGM(r.msg);
        });
    }

    return {
        start: function () {
            initState();
            registerHandlers();
            // Adopt an already-on Master switch (e.g. set before this script loaded,
            // or left on across a sandbox restart) so it doesn't need re-toggling.
            if (!getMaster()) {
                var existing = _.find(findObjs({ _type: "attribute" }), function (a) {
                    return isMasterAttr(a.get("name")) && isSwitchOn(a);
                });
                if (existing) state.RedemptionTagSync.masterId = existing.get("_characterid");
            }
            var master = getMaster();
            log("RedemptionTagSync ready. Master: " + (master ? master.get("name") : "none set") +
                ". Verbose: " + (verbose() ? "on" : "off") +
                ". GM: !tagsync | !tagsync verbose on/off | !tagsync debug");
        }
    };
})();

on("ready", function () {
    RedemptionTagSync.start();
});
