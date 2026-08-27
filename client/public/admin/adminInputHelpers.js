(function(root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.SurvivAdminInput = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function() {
    "use strict";

    function rounded(value, step) {
        return step >= 1 ? Math.round(value) : value;
    }

    function parseDraftNumber(rawValue, min, max, step) {
        const raw = String(rawValue ?? "").trim();
        // Empty and incomplete numeric states are valid while the user edits.
        if (raw === "" || raw === "-" || raw === "+" || raw === "." || raw === "-." || raw === "+.") {
            return null;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        return rounded(Math.min(max, Math.max(min, value)), step);
    }

    function normalizeDraftNumber(rawValue, fallback, min, max, step) {
        const parsed = parseDraftNumber(rawValue, min, max, step);
        if (parsed !== null) return parsed;
        const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : min;
        return rounded(Math.min(max, Math.max(min, safeFallback)), step);
    }

    return { parseDraftNumber, normalizeDraftNumber };
});
