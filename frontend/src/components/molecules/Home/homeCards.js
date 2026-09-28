import { reactive } from "vue";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

// Every id here must be in HOME_CARD_IDS (Modules/Users/helpers/homeCardsRules.js), or the server refuses the save.
export const HOME_CARDS = Object.freeze([
    { id: "waiting", labelKey: "Home.card_waiting", hintKey: "Home.card_waiting_hint" },
    { id: "standup", labelKey: "Home.card_standup", hintKey: "Home.card_standup_hint" }
]);

export const homeCards = reactive({ userId: null, hidden: [] });

export function resetHomeCards() {
    homeCards.userId = null;
    homeCards.hidden = [];
}

export function syncHomeCards(userId, stored) {
    if (!userId || homeCards.userId === userId) return;
    homeCards.userId = userId;
    homeCards.hidden = Array.isArray(stored?.hidden) ? stored.hidden.filter((id) => HOME_CARDS.some((c) => c.id === id)) : [];
}

export const isHomeCardShown = (id) => !homeCards.hidden.includes(id);

export async function setHomeCardShown(id, shown) {
    const before = [...homeCards.hidden];
    const hidden = shown ? before.filter((x) => x !== id) : [...new Set([...before, id])];
    homeCards.hidden = hidden;
    try {
        const res = await apiRequestWithoutCompnay("put", env.USER_HOME_CARDS, { hidden });
        if (!res?.data?.status) throw new Error(res?.data?.statusText || "Home cards not saved");
    } catch (error) {
        homeCards.hidden = before;
        throw error;
    }
}
