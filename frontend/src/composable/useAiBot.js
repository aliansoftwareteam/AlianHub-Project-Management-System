import { ref } from "vue";

// Per-user (local) AI Bot visibility.
//
// The AI Bot itself is ONE shared user (so task assignments, names and notifications
// resolve correctly for everyone). But WHO sees it in the assignee picker is a
// personal, per-developer choice kept entirely on the client — nothing per-user is
// stored in the database. A developer who turns it on gets the "AI Bot" option in
// their own picker; it never clutters other members' pickers, and it never shows in
// the Members list (its membership is marked status:3 on the server).
export const AI_BOT_EMAIL = "ai-bot@alianhub.local";
const KEY = "alianhub:aiBotEnabled";

const read = () => {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
};

// Module-level ref → shared + reactive across every component that imports this.
const aiBotEnabled = ref(read());

export function useAiBot() {
    const setAiBotEnabled = (value) => {
        aiBotEnabled.value = !!value;
        try { localStorage.setItem(KEY, value ? "1" : "0"); } catch (e) { /* storage blocked — keep in-memory */ }
    };
    return { aiBotEnabled, setAiBotEnabled };
}
