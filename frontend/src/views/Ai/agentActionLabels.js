import { labelSlug } from "./plainLabels";

const NAMESPACE = "AgentActions";

/* An action the locale has no words for keeps the label it was handed, which is the registry's own. */
export const agentActionLabel = (t, action, fallback = "") => {
    if (!action) return fallback;
    const key = `${NAMESPACE}.${labelSlug(action)}`;
    const words = t(key);
    return words && words !== key ? words : fallback;
};

/* The server marks a change that was filed with no words of its own (Modules/Agents/changeLabels.js). */
export const changeLabel = (t, change) => {
    const filed = String(change?.label || "");
    return change?.stockLabel ? agentActionLabel(t, change.action, filed) : filed;
};
