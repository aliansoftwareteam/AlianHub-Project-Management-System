<template>
    <div class="ah-agent-strip" :class="[`is-${run.status || 'running'}`, { 'has-session': session }]" role="status">
        <span class="ah-avatar ah-avatar--sm ah-avatar--agent" aria-hidden="true">◉</span>
        <span class="ah-agent-strip__name">{{ run.agentName || $t('TaskPanel.agent') }}</span>
        <span class="ah-chip ah-chip--agent ah-chip--mono ah-agent-strip__tag">{{ session ? $t('TaskPanel.agent_outside_tag') : $t('TaskPanel.agent_tag') }}</span>
        <span class="ah-agent-strip__text">{{ statusText }}</span>
        <span v-if="elapsed" class="ah-agent-strip__elapsed ah-mono">{{ elapsed }}</span>
        <span v-if="run.status === 'running'" class="ah-dot ah-dot--ok ah-agent-strip__pulse" aria-hidden="true"></span>
        <button v-if="run.status === 'running' && run.onStop" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="run.onStop">{{ $t('TaskPanel.agent_stop') }}</button>
        <ol v-if="recent.length" class="ah-agent-strip__activities" :aria-label="$t('TaskPanel.agent_activities')">
            <li v-for="(item, index) in recent" :key="`${item.at}-${index}`" class="ah-agent-strip__activity" :class="`is-${item.type}`">
                <span class="ah-chip ah-chip--mono ah-agent-strip__kind">{{ activityLabel(item.type) }}</span>
                <span class="ah-agent-strip__activity-text">{{ item.text }}</span>
            </li>
        </ol>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { formatClock } from "./useTaskTimer";

defineOptions({ name: "TaskAgentStrip" });

/**
 * @typedef {Object} AgentRun
 * @property {string} agentName
 * @property {'running'|'review'|'done'|'failed'} status
 * @property {number|string} [startedAt]   epoch ms or ISO string
 * @property {string} [summary]            one line shown while working / after finishing
 * @property {Function} [onStop]
 * @property {Object} [session]            an outside agent's session: state, reason and typed activities
 */
const props = defineProps({
    run: { type: Object, required: true }
});

const SHOWN_ACTIVITIES = 3;
const SESSION_TEXT = {
    offered: "TaskPanel.agent_session_offered",
    active: "TaskPanel.agent_session_active",
    completed: "TaskPanel.agent_session_completed",
    failed: "TaskPanel.agent_session_failed",
    revoked: "TaskPanel.agent_session_revoked",
    unresponsive: "TaskPanel.agent_session_unresponsive"
};
const ACTIVITY_TEXT = {
    thought: "TaskPanel.agent_activity_thought",
    action: "TaskPanel.agent_activity_action",
    elicitation: "TaskPanel.agent_activity_elicitation",
    response: "TaskPanel.agent_activity_response",
    error: "TaskPanel.agent_activity_error"
};

const { t } = useI18n();
const now = ref(Date.now());
let tick = null;

const session = computed(() => props.run.session || null);
const recent = computed(() => (session.value?.activities || []).slice(-SHOWN_ACTIVITIES).reverse());
const activityLabel = (type) => (ACTIVITY_TEXT[type] ? t(ACTIVITY_TEXT[type]) : type);

const statusText = computed(() => {
    if (props.run.summary) return props.run.summary;
    if (session.value) {
        const key = SESSION_TEXT[session.value.state] || SESSION_TEXT.active;
        return session.value.reason && ["failed", "revoked"].includes(session.value.state)
            ? t("TaskPanel.agent_session_with_reason", { state: t(key), reason: session.value.reason })
            : t(key);
    }
    switch (props.run.status) {
        case "review": return t("TaskPanel.agent_in_review");
        case "done": return t("TaskPanel.agent_done");
        case "failed": return t("TaskPanel.agent_failed");
        default: return t("TaskPanel.agent_working");
    }
});
const elapsed = computed(() => {
    if (props.run.status !== "running" || !props.run.startedAt) return "";
    const started = typeof props.run.startedAt === "number" ? props.run.startedAt : new Date(props.run.startedAt).getTime();
    if (Number.isNaN(started)) return "";
    return formatClock(Math.max(0, Math.floor((now.value - started) / 1000)));
});

onMounted(() => { tick = setInterval(() => { now.value = Date.now(); }, 1000); });
onBeforeUnmount(() => { if (tick) clearInterval(tick); });
</script>
