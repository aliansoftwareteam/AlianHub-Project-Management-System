import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { HOST_REASONS, HOST_STATES } from "./declaredReads";

const CHECK_DELAY_MS = 400;
const TONE = { allowed: "ah-chip--ok", not_listed: "ah-chip--warn", not_declarable: "ah-chip--danger" };

export const useHostCheck = (hostOf) => {
    const { t } = useI18n();
    const state = ref("");
    const reason = ref("");
    let timer = null;
    let asked = 0;

    const chip = computed(() => (state.value ? { text: t(`Ai.skill_read_chip_${state.value}`), tone: TONE[state.value] || "" } : null));
    const reasonText = computed(() => t(`Ai.skill_read_host_${HOST_REASONS.includes(reason.value) ? reason.value : "invalid"}`, { host: hostOf() || "" }));

    /* Only the latest answer lands: a slow reply for an earlier spelling must not overwrite the current one. */
    const check = async (host) => {
        asked += 1;
        const mine = asked;
        if (!host) { state.value = ""; return; }
        state.value = "checking";
        try {
            const res = await apiRequest("get", `${env.AGENT_SKILL_EGRESS_CHECK}?host=${encodeURIComponent(host)}`);
            if (mine !== asked) return;
            const data = res?.data?.status ? res.data.data : null;
            state.value = data && HOST_STATES.includes(data.state) ? data.state : "unchecked";
            reason.value = data?.reason || "";
        } catch (e) {
            if (mine === asked) state.value = "unchecked";
        }
    };

    watch(hostOf, (host) => {
        clearTimeout(timer);
        timer = setTimeout(() => check(host), CHECK_DELAY_MS);
    });
    onMounted(() => check(hostOf()));
    onBeforeUnmount(() => clearTimeout(timer));

    return { state, chip, reasonText };
};
