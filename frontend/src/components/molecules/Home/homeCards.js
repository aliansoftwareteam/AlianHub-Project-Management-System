import { reactive } from "vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";
import { catalogEntry } from "@/plugins/dashboard/cardCatalog";

// Every id here and in HOME_CATALOG_KEYS must be in HOME_CARD_IDS (Modules/Users/helpers/homeCardsRules.js), or the server drops it on save.
export const HOME_CARDS = Object.freeze([
    { id: "waiting", labelKey: "Home.card_waiting", hintKey: "Home.card_waiting_hint" },
    { id: "standup", labelKey: "Home.card_standup", hintKey: "Home.card_standup_hint" },
    { id: "assigned_comments", labelKey: "Home.assigned_comments", hintKey: "Home.card_assigned_comments_hint" },
    { id: "recents", labelKey: "Home.card_recents", hintKey: "Home.card_recents_hint" },
    { id: "goals", labelKey: "Home.card_goals", hintKey: "Home.card_goals_hint" }
]);

// Dashboard cards that need no per-card setup; each loads through its own endpoint, which applies the dashboard's access rules.
export const HOME_CATALOG_KEYS = Object.freeze(["DueSoonCard", "MyTimeCard", "AtRiskTodayCard", "TasksByStatusCard", "ProjectPulseCard"]);

export const DEFAULT_HOME_LAYOUT = Object.freeze(["waiting", "assigned_comments", "recents", "standup"]);

export function homeCardInfo(id) {
    const own = HOME_CARDS.find((card) => card.id === id);
    if (own) return { ...own, kind: "home" };
    const entry = HOME_CATALOG_KEYS.includes(id) ? catalogEntry(id) : null;
    if (!entry || !entry.built) return null;
    return { id, kind: "catalog", labelKey: entry.titleKey, hintKey: entry.answerKey, entry };
}

export function resolveHomeLayout(stored) {
    const hidden = Array.isArray(stored?.hidden) ? stored.hidden : [];
    const source = Array.isArray(stored?.layout) ? stored.layout : DEFAULT_HOME_LAYOUT.filter((id) => !hidden.includes(id));
    return [...new Set(source.filter((id) => typeof id === "string" && homeCardInfo(id)))];
}

export const homeCards = reactive({ userId: null, layout: [...DEFAULT_HOME_LAYOUT] });

export function resetHomeCards() {
    homeCards.userId = null;
    homeCards.layout = [...DEFAULT_HOME_LAYOUT];
}

export function syncHomeCards(userId, stored) {
    if (!userId || homeCards.userId === userId) return;
    homeCards.userId = userId;
    homeCards.layout = resolveHomeLayout(stored);
}

export const isHomeCardShown = (id) => homeCards.layout.includes(id);

export async function saveHomeLayout(next) {
    const before = [...homeCards.layout];
    const layout = resolveHomeLayout({ layout: next });
    homeCards.layout = layout;
    try {
        const res = await apiRequestWithoutCompnay("put", env.USER_HOME_CARDS, { layout });
        if (!res?.data?.status) throw new Error(res?.data?.statusText || "Home cards not saved");
    } catch (error) {
        homeCards.layout = before;
        throw error;
    }
}

export async function addHomeCard(id) {
    if (isHomeCardShown(id) || !homeCardInfo(id)) return;
    await saveHomeLayout([...homeCards.layout, id]);
}

export async function removeHomeCard(id) {
    if (!isHomeCardShown(id)) return;
    await saveHomeLayout(homeCards.layout.filter((x) => x !== id));
}

export async function moveHomeCard(id, toIndex) {
    const from = homeCards.layout.indexOf(id);
    const to = Math.max(0, Math.min(toIndex, homeCards.layout.length - 1));
    if (from < 0 || from === to) return;
    const next = [...homeCards.layout];
    next.splice(from, 1);
    next.splice(to, 0, id);
    await saveHomeLayout(next);
}

export const setHomeCardShown = (id, shown) => (shown ? addHomeCard(id) : removeHomeCard(id));
