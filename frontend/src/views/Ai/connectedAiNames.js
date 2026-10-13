import { reactive } from "vue";
import { fetchConnectedAgents } from "@/views/Ai/useRunnableAgents";

/* The names a member reads for the connected AIs of the people beside them ("Claude, for Priya"), by the person's id.
 * The server gives a guest none, so a guest reads none here. One read serves a workspace until it is this old. */
const FRESH_MS = 5 * 60 * 1000;
const known = reactive({ companyId: "", shownAs: {} });
let asked = { companyId: "", at: 0 };

export function loadConnectedAiNames(companyId) {
    const id = String(companyId || "");
    if (!id || (asked.companyId === id && Date.now() - asked.at < FRESH_MS)) return;
    asked = { companyId: id, at: Date.now() };
    fetchConnectedAgents().then((entries) => {
        if (asked.companyId !== id) return;
        known.companyId = id;
        known.shownAs = Object.fromEntries(entries.map((entry) => [entry.ownerId, entry.shownAs]));
    });
}

export const connectedAiNameOf = (companyId, ownerId) => (known.companyId === String(companyId || "") && known.shownAs[ownerId]) || "";
