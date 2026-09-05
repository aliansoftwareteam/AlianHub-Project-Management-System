<template>
    <div v-if="items.length" class="live">
        <span class="ah-label live__label">{{ $t('Pipeline.live') }}</span>

        <span v-for="(item, i) in items" :key="item.key" class="live__item">
            <span v-if="i" class="live__sep">·</span>
            <span class="ah-avatar live__avatar" :class="item.agent ? 'ah-avatar--agent ah-avatar--sm' : 'ah-avatar--sm'">
                <ShellIcon :name="item.agent ? 'agent' : 'user'" :size="10" />
            </span>
            <strong>{{ item.who }}</strong>
            <span>{{ item.what }}</span>
        </span>

        <button v-if="running" type="button" class="live__pause" :disabled="pausing" @click="onPauseAll">
            {{ $t('Pipeline.pause_all') }}
        </button>
    </div>

    <transition name="ah-fade">
        <div v-if="toast" class="live-toast">
            <div class="live-toast__head">
                <span class="ah-avatar ah-avatar--agent ah-avatar--sm"><ShellIcon name="agent" :size="11" /></span>
                <strong>{{ $t('Pipeline.toast_finished', { agent: toast.agentName }) }}</strong>
                <span class="ah-mono live-toast__at">{{ $t('Pipeline.now') }}</span>
            </div>
            <p class="live-toast__body">{{ toast.outcome || $t('Pipeline.toast_no_outcome', { status: toast.status }) }}</p>
            <div class="live-toast__actions">
                <router-link
                    v-if="toast.primary === 'review'"
                    class="live-toast__btn live-toast__btn--primary"
                    :to="{ name: 'AiInbox', params: { cid: companyId } }"
                    @click="dismiss"
                >{{ $t('Pipeline.toast_review') }}</router-link>
                <router-link
                    v-else
                    class="live-toast__btn live-toast__btn--primary"
                    :to="{ name: 'AiPipeline', params: { cid: companyId } }"
                    @click="dismiss"
                >{{ $t('Pipeline.toast_open_pipeline') }}</router-link>
                <button type="button" class="live-toast__btn" @click="dismiss">{{ $t('Pipeline.toast_dismiss') }}</button>
            </div>
        </div>
    </transition>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { shellState } from "@/components/organisms/Shell/shellState";
import { useAgentFinishToast } from "./useAgentFinishToast";
import { reasonOf } from "./useAgents";

// 28b surface 4 — one 40px line mixing people and agents. It is the only place
// both are read from the same request, so the strip and the rail footer can
// never disagree about how many agents are working.
defineOptions({ name: "AgentLiveStrip" });

const POLL_MS = 30000;
const MAX_ITEMS = 4;

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId", localStorage.getItem("selectedCompany") || "");
const { toast, observe, dismiss, reset } = useAgentFinishToast();

const people = ref([]);
const agents = ref([]);
const pausing = ref(false);
let poller = null;

const ok = (res) => res?.data?.status === true;
const running = computed(() => agents.value.filter((a) => a.status === "running").length);

const items = computed(() => {
    const live = agents.value
        .filter((a) => a.run)
        .map((a) => ({
            key: `a-${a.id}`,
            agent: true,
            who: a.name,
            what: a.run.taskKey || a.run.taskName
                ? t("Pipeline.live_on", { what: a.run.taskKey || a.run.taskName })
                : t("Pipeline.live_running")
        }));
    const busy = people.value
        .filter((p) => p.timer && p.timer.taskName)
        .map((p) => ({ key: `p-${p.id}`, agent: false, who: p.name, what: t("Pipeline.live_on", { what: p.timer.taskName }) }));
    return [...live, ...busy].slice(0, MAX_ITEMS);
});

const load = async () => {
    const [teamRes, runsRes] = await Promise.allSettled([
        apiRequest("get", env.AGENT_TEAM),
        apiRequest("get", `${env.AGENT_RUNS}?limit=25`)
    ]);
    if (teamRes.status === "fulfilled" && ok(teamRes.value)) {
        const data = teamRes.value.data.data || {};
        people.value = data.people || [];
        agents.value = data.agents || [];
        shellState.agentsRunning = Number(data.totals?.running || 0);
    }
    if (runsRes.status === "fulfilled" && ok(runsRes.value)) observe(runsRes.value.data.data || []);
};

const onPauseAll = async () => {
    pausing.value = true;
    try {
        const res = await apiRequest("post", env.AGENT_PAUSE_ALL, {});
        if (!ok(res)) throw new Error(res?.data?.statusText || t("Ai.pause_failed"));
        await load();
    } catch (error) {
        $toast.error(reasonOf(error, "Ai.pause_failed"), { position: "top-right" });
    } finally {
        pausing.value = false;
    }
};

onMounted(() => {
    load().catch(() => {});
    poller = setInterval(() => load().catch(() => {}), POLL_MS);
});

onBeforeUnmount(() => {
    if (poller) clearInterval(poller);
    poller = null;
    reset();
});
</script>

<style>
@import "./shipping.css";
</style>
