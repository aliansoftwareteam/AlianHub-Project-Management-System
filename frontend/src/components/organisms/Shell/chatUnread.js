import { computed, inject, reactive, watch } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import { useCustomComposable } from "@/composable";
import * as env from "@/config/env";

const positive = (value) => Math.max(0, Number(value) || 0);
const granted = (permission) => permission !== null && permission !== undefined;

// One list for the whole page, so the rail and the phone tab bar ask the server once between them.
const known = reactive({ companyId: "", spaces: [], direct: [], channels: [], loading: false });
let retried = new Set();

async function load(companyId) {
    if (!companyId || known.loading) return;
    known.loading = true;
    try {
        const response = await apiRequest("get", env.MAIN_CHAT_UNREAD_KEYS);
        const data = (response && response.data && response.data.data) || {};
        if (known.companyId !== companyId) retried = new Set();
        Object.assign(known, { companyId, spaces: data.spaces || [], direct: data.direct || [], channels: data.channels || [] });
    } catch (error) {
        console.error("ERROR in chat unread keys: ", error);
    } finally {
        known.loading = false;
    }
}

/* Whether this person may open Chat at all, and its direct messages. */
export function useChatAccess() {
    const { getters } = useStore();
    const { checkPermission } = useCustomComposable();
    const ready = computed(() => {
        const rules = getters["settings/rules"];
        return Boolean(rules && Object.keys(rules).length);
    });
    const canOpenChat = computed(() => ready.value && granted(checkPermission("chat")));
    const canReadDirect = computed(() => canOpenChat.value && typeof checkPermission("chat.one_to_one_chat") === "boolean");
    return { canOpenChat, canReadDirect };
}

/* The unread messages of the conversations the Chat page lists, summed from the same counters its sidebar shows. */
export function useChatUnread() {
    const { getters } = useStore();
    const companyId = inject("$companyId");
    const { canOpenChat, canReadDirect } = useChatAccess();
    const counts = computed(() => (getters["users/myCounts"] && getters["users/myCounts"].data) || {});

    watch(() => [canOpenChat.value, companyId && companyId.value], ([allowed, company]) => {
        if (allowed && company && known.companyId !== company) load(company);
    }, { immediate: true });

    // A count under a chat space that the list does not hold is a conversation that started after it was read.
    // Each such key is asked about once, so a count left behind by a closed conversation never loops.
    watch(counts, (now) => {
        if (!canOpenChat.value || known.loading || !known.companyId) return;
        const listed = new Set([...known.direct, ...known.channels]);
        const spaces = known.spaces.map((id) => `task_${id}_`);
        const fresh = Object.keys(now).filter((key) => positive(now[key]) && !listed.has(key) && !retried.has(key)
            && spaces.some((prefix) => key.startsWith(prefix)));
        if (!fresh.length) return;
        fresh.forEach((key) => retried.add(key));
        load(known.companyId);
    });

    const unread = computed(() => {
        if (!canOpenChat.value) return 0;
        const keys = [...(canReadDirect.value ? known.direct : []), ...known.channels];
        return keys.reduce((total, key) => total + positive(counts.value[key]), 0);
    });
    const badge = computed(() => (unread.value > 99 ? "99+" : String(unread.value)));
    return { unread, badge };
}
