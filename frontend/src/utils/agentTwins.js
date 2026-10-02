const nameKey = (agent) => String(agent?.name || "").trim().toLowerCase();

/* Two agents may carry one name; what each does is then all that tells them apart in a list. */
export function twinNotes(agents) {
    const named = new Map();
    (agents || []).forEach((agent) => named.set(nameKey(agent), (named.get(nameKey(agent)) || 0) + 1));
    return (agent) => (named.get(nameKey(agent)) > 1 ? String(agent.description || "").trim() : "");
}
