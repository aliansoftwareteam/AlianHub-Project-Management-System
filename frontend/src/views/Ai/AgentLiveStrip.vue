<template>
    <div v-if="items.length" class="live" :class="{ 'live--compact': compact }">
        <template v-if="compact">
            <ul v-if="expanded" :id="listId" class="live__list" data-test="live-list">
                <li v-for="item in all" :key="item.key" class="live__row">
                    <span class="ah-avatar live__avatar" :class="item.agent ? 'ah-avatar--agent ah-avatar--sm' : 'ah-avatar--sm'">
                        <ShellIcon :name="item.agent ? 'agent' : 'user'" :size="10" />
                    </span>
                    <strong class="live__who">{{ item.who }}</strong>
                    <span class="live__what">{{ item.what }}</span>
                </li>
            </ul>
            <button
                type="button"
                class="live__summary"
                data-test="live-summary"
                :aria-expanded="String(expanded)"
                :aria-controls="listId"
                @click="expanded = !expanded"
            >
                <span class="ah-label live__label">{{ $t('Pipeline.live') }}</span>
                <span class="live__count">{{ summary }}</span>
                <ShellIcon name="chevronDown" :size="12" class="live__caret" :class="{ 'is-open': expanded }" />
            </button>
        </template>
        <template v-else>
            <span class="ah-label live__label">{{ $t('Pipeline.live') }}</span>

            <span v-for="(item, i) in items" :key="item.key" class="live__item">
                <span v-if="i" class="live__sep">·</span>
                <span class="ah-avatar live__avatar" :class="item.agent ? 'ah-avatar--agent ah-avatar--sm' : 'ah-avatar--sm'">
                    <ShellIcon :name="item.agent ? 'agent' : 'user'" :size="10" />
                </span>
                <strong>{{ item.who }}</strong>
                <span>{{ item.what }}</span>
            </span>
        </template>

        <button v-if="running && canManage" type="button" class="live__pause" data-test="pause-all" :disabled="pausing" @click="onPauseAll">
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
import { computed, inject, onBeforeUnmount, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useAgentFinishToast } from "./useAgentFinishToast";
import { reasonOf } from "./useAgents";
import { useAgentAccess } from "./agentAccess";
import { useLiveAgents } from "./useLiveAgents";

defineOptions({ name: "AgentLiveStrip" });

const MAX_ITEMS = 4;
const PHONE_MAX = 767;

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId", localStorage.getItem("selectedCompany") || "");
const clientWidth = inject("$clientWidth", ref(window.innerWidth));
const compact = computed(() => Number(clientWidth.value) <= PHONE_MAX);
const expanded = ref(false);
const listId = `live-list-${useId()}`;
const { toast, observe, dismiss, reset } = useAgentFinishToast();
const { canManage } = useAgentAccess();

const pausing = ref(false);

const ok = (res) => res?.data?.status === true;

const { people, live, running, refresh } = useLiveAgents({ onRuns: observe });

const all = computed(() => {
    const agentsLive = live.value
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
    return [...agentsLive, ...busy];
});
const items = computed(() => all.value.slice(0, MAX_ITEMS));
const summary = computed(() => {
    const agentCount = all.value.filter((i) => i.agent).length;
    return agentCount === all.value.length
        ? t("Pipeline.live_agents", { n: agentCount }, agentCount)
        : t("Pipeline.live_mixed", { n: all.value.length });
});

const onPauseAll = async () => {
    pausing.value = true;
    try {
        const res = await apiRequest("post", env.AGENT_PAUSE_ALL, {});
        if (!ok(res)) throw new Error(res?.data?.statusText || t("Ai.pause_failed"));
        await refresh();
    } catch (error) {
        $toast.error(reasonOf(error, "Ai.pause_failed"), { position: "top-right" });
    } finally {
        pausing.value = false;
    }
};

onBeforeUnmount(reset);
</script>

<style>
@import "./shipping.css";
</style>
