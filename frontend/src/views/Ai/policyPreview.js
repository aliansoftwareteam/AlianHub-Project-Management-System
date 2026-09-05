/* Mirror of the L2 rule in Modules/Agents/policy.js so the settings page can
 * show what an agent will do on its own. The server decides at run time; this
 * only has to agree with it, which policyPreview.spec.js pins down. */
export const ACT = "act";
export const PROPOSE = "propose";

export function decideForRating(rating, action = {}) {
    const write = rating ? rating.write !== false : action.write !== false;
    if (!write) return { decision: ACT, reason: "read" };
    if (!rating) return { decision: PROPOSE, reason: "unrated" };
    if (rating.money) return { decision: PROPOSE, reason: "money" };
    if (!rating.reversible) return { decision: PROPOSE, reason: "irreversible" };
    if (rating.scope !== "task") return { decision: PROPOSE, reason: "scope" };
    return { decision: ACT, reason: "safe" };
}

export function previewActions(allowedKeys, registryActions) {
    const allowed = new Set((allowedKeys || []).map(String));
    return (registryActions || [])
        .filter((action) => allowed.has(action.key))
        .map((action) => ({ key: action.key, label: action.label || action.key, ...decideForRating(action.rating, action) }));
}

export function splitPreview(allowedKeys, registryActions) {
    const items = previewActions(allowedKeys, registryActions);
    return { acts: items.filter((i) => i.decision === ACT), proposes: items.filter((i) => i.decision === PROPOSE) };
}
