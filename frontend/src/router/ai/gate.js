import { AI_STATE } from "@/composable/aiAvailability";

/* Screens whose purpose is a model answering: asking a question, agent runs and what they
 * propose. Every other AI-section screen (skills, agent settings, teammates, routing, health,
 * coding accounts and MCP tokens, connections, workflows) is configuration or history and makes
 * no model call of its own, so it stays reachable whatever the switch says; the server refuses
 * any model call it would trigger. */
export const MODEL_DRIVEN_ROUTES = Object.freeze(["AiAsk", "AiInbox", "AiHub", "AiPipeline", "AiRelease"]);

export const AI_GATE = Object.freeze({ PAGE: "page", NOTICE: "notice" });

/* "page" replaces the screen with the AI-off panel; "notice" keeps the screen and adds a
 * non-blocking line saying answers are not available; null leaves the screen alone. No provider
 * is never a reason to hide a screen: Ask still answers from sources and agents can be set up. */
export function aiGateFor(routeName, state) {
    if (!MODEL_DRIVEN_ROUTES.includes(routeName)) return null;
    if (state === AI_STATE.OFF_INSTANCE || state === AI_STATE.OFF_WORKSPACE) return AI_GATE.PAGE;
    if (state === AI_STATE.UNCONFIGURED) return AI_GATE.NOTICE;
    return null;
}
