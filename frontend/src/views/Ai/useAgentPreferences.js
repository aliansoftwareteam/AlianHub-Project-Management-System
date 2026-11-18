import { computed, reactive, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { i18n } from "@/locales/main";
import { reasonOf } from "./useAgents";

export const TONES = Object.freeze(["concise", "detailed"]);
export const REVIEW_DEPTHS = Object.freeze(["summary", "every_change"]);

const request = async (type, endpoint, body, fallbackKey) => {
    let res;
    try {
        res = await apiRequest(type, endpoint, body);
    } catch (error) {
        throw new Error(reasonOf(error, fallbackKey));
    }
    if (res?.data?.status !== true) throw new Error(res?.data?.statusText || res?.data?.message || i18n.global.t(fallbackKey));
    return res.data.data || {};
};

const pick = (value, allowed) => (allowed.includes(value) ? value : null);

export function useAgentPreferences() {
    const draft = reactive({ tone: null, reviewDepth: null, notify: true });
    const baseline = reactive({ ...draft });
    const candidates = ref([]);
    const loaded = ref(false);
    const busy = ref(false);
    const error = ref("");

    const dirty = computed(() => draft.tone !== baseline.tone || draft.reviewDepth !== baseline.reviewDepth || draft.notify !== baseline.notify);

    const seed = (prefs) => {
        draft.tone = pick(prefs.tone, TONES);
        draft.reviewDepth = pick(prefs.reviewDepth, REVIEW_DEPTHS);
        draft.notify = prefs.notify !== false;
        Object.assign(baseline, { tone: draft.tone, reviewDepth: draft.reviewDepth, notify: draft.notify });
        if (Array.isArray(prefs.candidates)) candidates.value = prefs.candidates;
    };

    const load = async () => {
        error.value = "";
        try {
            seed(await request("get", env.AGENT_PREFERENCES, undefined, "Settings.agents_load_failed"));
            loaded.value = true;
        } catch (e) {
            error.value = e.message;
        }
    };

    const changes = () => Object.fromEntries(Object.keys(draft).filter((k) => draft[k] !== baseline[k]).map((k) => [k, draft[k]]));

    const save = async () => {
        const body = changes();
        if (!Object.keys(body).length) return;
        busy.value = true;
        try {
            seed(await request("put", env.AGENT_PREFERENCES, body, "Settings.agents_save_failed"));
        } finally {
            busy.value = false;
        }
    };

    const settle = async (candidate, status) => {
        busy.value = true;
        try {
            await request("put", `${env.AGENT_MEMORY}/${encodeURIComponent(String(candidate.id))}`, { status }, "Settings.agents_save_failed");
            candidates.value = candidates.value.filter((c) => c.id !== candidate.id);
        } finally {
            busy.value = false;
        }
    };

    const accept = (candidate) => settle(candidate, "active");
    const dismiss = (candidate) => settle(candidate, "retired");

    return { draft, candidates, loaded, busy, error, dirty, load, save, accept, dismiss };
}
