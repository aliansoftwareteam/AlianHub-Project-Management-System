<template>
    <div class="picker">
        <div class="picker__main">
            <div class="picker__head">
                <span class="ah-mono picker__key">{{ task.TaskKey || '—' }}</span>
                <span class="ah-h3">{{ task.TaskName || $t('ParityV2.untitled_task') }}</span>
                <span class="ah-chip">{{ task.status || task.statusType || $t('ParityV2.no_status') }}</span>
            </div>

            <div class="picker__field">
                <label class="picker__field-label" for="assignee-search">{{ $t('ParityV2.assignee') }}</label>
                <input
                    id="assignee-search"
                    v-model="query"
                    class="ah-input picker__input"
                    type="text"
                    autocomplete="off"
                    :placeholder="$t('ParityV2.search_people_agents')"
                />
            </div>

            <div class="picker__list ah-scroll">
                <div class="picker__group">
                    <span class="ah-label">{{ $t('ParityV2.best_fit') }}</span>
                    <span class="picker__group-note">{{ $t('ParityV2.ranked_by') }}</span>
                </div>

                <p v-if="!rankedAgents.length" class="ah-empty picker__empty">{{ $t('ParityV2.no_agents_yet') }}</p>

                <button
                    v-for="row in rankedAgents"
                    :key="row.agentId"
                    type="button"
                    class="picker__row"
                    :class="{ 'is-chosen': chosen === row.agentId, 'is-blocked': !row.eligible }"
                    :disabled="!row.eligible"
                    @click="chosen = row.agentId"
                >
                    <span class="ah-avatar ah-avatar--agent ah-avatar--lg"><ShellIcon name="agent" :size="16" /></span>
                    <span class="picker__row-body">
                        <span class="picker__row-top">
                            <strong>{{ row.name }}</strong>
                            <span class="ah-chip ah-chip--agent ah-chip--mono">{{ badgeOf(row) }}</span>
                            <span class="picker__fit ah-mono" :class="fitClass(row)">{{ fitLabel(row) }}</span>
                        </span>
                        <span class="picker__row-why">{{ row.reason }}</span>
                        <span v-if="row.eligible" class="picker__row-facts ah-mono">
                            <span>{{ estimateTime(row) }}</span>
                            <span>{{ estimateCost(row) }}</span>
                            <span>{{ willLabel(row) }}</span>
                            <span v-if="row.coverage < 1" class="picker__row-limit">{{ $t('ParityV2.cannot_finish') }}</span>
                        </span>
                    </span>
                </button>

                <div class="picker__group"><span class="ah-label">{{ $t('ParityV2.people') }}</span></div>
                <button
                    v-for="person in filteredPeople"
                    :key="person.id"
                    type="button"
                    class="picker__row picker__row--person"
                    :class="{ 'is-chosen': chosen === person.id }"
                    @click="chosen = person.id"
                >
                    <span class="ah-avatar">{{ initials(person.name) }}</span>
                    <span class="picker__row-body">
                        <span class="picker__row-top"><strong>{{ person.name }}</strong></span>
                        <span class="picker__row-why" :class="{ 'picker__row-over': person.load > 100 }">{{ personLine(person) }}</span>
                    </span>
                </button>
                <p v-if="!filteredPeople.length" class="ah-empty picker__empty">{{ $t('ParityV2.no_people_match') }}</p>
            </div>

            <div class="ah-card picker__explain">
                <div class="ah-label">{{ $t('ParityV2.fit_made_of') }}</div>
                <p>{{ $t('ParityV2.fit_explainer') }}</p>
                <p>{{ $t('ParityV2.fit_no_history') }}</p>
            </div>
        </div>

        <aside class="picker__aside">
            <div class="ah-label">{{ $t('ParityV2.before_confirm') }}</div>

            <div v-if="selectedAgent" class="picker__confirm">
                <AgentIdentity :name="selectedAgent.name" size="lg" />
                <dl class="picker__facts">
                    <div><dt>{{ $t('ParityV2.runs_as') }}</dt><dd>{{ runsAs }}</dd></div>
                    <div><dt>{{ $t('ParityV2.cost_to_you') }}</dt><dd :class="{ 'picker__free': costToYou === '$0' }">{{ costToYou }}</dd></div>
                    <div><dt>{{ $t('ParityV2.starts') }}</dt><dd>{{ $t('ParityV2.starts_now') }}</dd></div>
                    <div><dt>{{ $t('ParityV2.will_set') }}</dt><dd>{{ willSet }}</dd></div>
                    <div><dt>{{ $t('ParityV2.wont') }}</dt><dd>{{ wontLine }}</dd></div>
                </dl>
                <p class="picker__note">{{ $t('ParityV2.handback_note') }}</p>
            </div>

            <div v-else-if="selectedPerson" class="picker__confirm">
                <div class="picker__person"><span class="ah-avatar ah-avatar--lg">{{ initials(selectedPerson.name) }}</span><strong>{{ selectedPerson.name }}</strong></div>
                <p class="picker__note">{{ personLine(selectedPerson) }}</p>
            </div>

            <p v-else class="ah-empty picker__empty">{{ $t('ParityV2.pick_someone') }}</p>

            <div class="picker__also">
                <div class="ah-label">{{ $t('ParityV2.also_set') }}</div>
                <label class="picker__check"><input v-model="notifyMe" class="ah-check" type="checkbox" />{{ $t('ParityV2.notify_me') }}</label>
                <label class="picker__check"><input v-model="capped" class="ah-check" type="checkbox" />{{ $t('ParityV2.stop_over_cap', { usd: '2' }) }}</label>
            </div>

            <p v-if="error" class="ah-field__error">{{ error }}</p>

            <div class="picker__actions">
                <button type="button" class="ah-btn ah-btn--primary ah-btn--block" :disabled="!chosen || busy" @click="confirm">
                    {{ busy ? $t('ParityV2.assigning') : $t('ParityV2.assign') }}
                </button>
                <button type="button" class="ah-btn ah-btn--secondary" @click="$emit('close')">{{ $t('ParityV2.cancel') }}</button>
            </div>
        </aside>
    </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AgentIdentity from "./AgentIdentity.vue";
import { rankAgents } from "./agentFit";

// The fit-ranked assignee picker (handoff 30a). Ranking is the pure helper in
// agentFit.js; this component only draws it and states what it is about to do
// before it does it.
defineOptions({ name: "AgentPicker" });

const props = defineProps({
    task: { type: Object, required: true },
    agents: { type: Array, default: () => [] },
    people: { type: Array, default: () => [] },
    runs: { type: Array, default: () => [] },
    registryActions: { type: Array, default: () => [] },
    never: { type: Array, default: () => [] },
    busy: { type: Boolean, default: false },
    error: { type: String, default: "" }
});

const emit = defineEmits(["assign", "close"]);
const { t } = useI18n();

const query = ref("");
const chosen = ref("");
const notifyMe = ref(true);
const capped = ref(false);

const matches = (name) => !query.value || String(name || "").toLowerCase().includes(query.value.trim().toLowerCase());

const rankedAgents = computed(() => rankAgents({
    agents: props.agents.filter((a) => matches(a.name)),
    task: props.task,
    runs: props.runs,
    registryActions: props.registryActions,
    never: props.never
}));

const filteredPeople = computed(() => props.people.filter((p) => matches(p.name)));

const selectedAgent = computed(() => rankedAgents.value.find((r) => r.agentId === chosen.value) || null);
const selectedPerson = computed(() => filteredPeople.value.find((p) => p.id === chosen.value) || null);

watch(rankedAgents, (rows) => {
    if (chosen.value) return;
    const best = rows.find((r) => r.eligible);
    if (best) chosen.value = best.agentId;
}, { immediate: true });

const initials = (name) => String(name || "?").trim().slice(0, 1).toUpperCase();
/* The badge says whose key pays and how far the agent may act on its own — the
 * two facts that decide whether assigning it is free or spends the workspace's
 * budget. */
const badgeOf = (row) => {
    const agent = props.agents.find((a) => String(a._id) === row.agentId) || {};
    const account = agent.account === "personal" || agent.account === "local"
        ? t("ParityV2.badge_personal")
        : t("ParityV2.badge_workspace");
    return `${account} · L${Number(agent.autonomy || 0)}`;
};

const fitLabel = (row) => {
    if (!row.eligible) return t("ParityV2.not_eligible");
    if (row.percent === null) return t("ParityV2.no_history_yet");
    return t("ParityV2.percent_fit", { n: row.percent });
};
const fitClass = (row) => {
    if (!row.eligible) return "picker__fit--off";
    return row.percent !== null && row.percent >= 80 ? "picker__fit--good" : "";
};

const estimateTime = (row) => (row.estimate.minutes === null ? t("ParityV2.time_unknown") : t("ParityV2.about_minutes", { n: row.estimate.minutes }));
const estimateCost = (row) => (row.estimate.usd === null ? t("ParityV2.cost_unknown") : t("ParityV2.about_usd", { usd: row.estimate.usd.toFixed(2) }));
const willLabel = (row) => (row.coverage >= 1 ? row.work.label : t("ParityV2.comment_only"));

const personLine = (person) => {
    const bits = [];
    if (person.pto && person.pto.active) bits.push(t("ParityV2.away_until", { date: String(person.pto.to).slice(0, 10) }));
    if (person.load > 100) bits.push(t("ParityV2.percent_loaded", { n: person.load }));
    else bits.push(t("ParityV2.free_hours", { n: Math.max(0, Math.round((person.capacityHours || 40) - (person.loggedHours || 0))) }));
    return bits.join(" · ");
};

const runsAs = computed(() => {
    const agent = props.agents.find((a) => String(a._id) === chosen.value);
    if (!agent) return "";
    return agent.account === "personal" ? t("ParityV2.runs_personal") : t("ParityV2.runs_workspace");
});

const costToYou = computed(() => {
    const agent = props.agents.find((a) => String(a._id) === chosen.value);
    if (!agent) return "";
    if (agent.account === "personal" || agent.account === "local") return "$0";
    const est = selectedAgent.value && selectedAgent.value.estimate.usd;
    return est === null || est === undefined ? t("ParityV2.cost_unknown") : `~$${est.toFixed(2)}`;
});

const willSet = computed(() => (selectedAgent.value && selectedAgent.value.will.length
    ? selectedAgent.value.will.slice(0, 3).join(", ")
    : t("ParityV2.nothing_yet")));

const wontLine = computed(() => (selectedAgent.value ? selectedAgent.value.wont.slice(0, 4).join(", ") : ""));

const confirm = () => {
    if (!chosen.value) return;
    emit("assign", {
        kind: selectedAgent.value ? "agent" : "person",
        id: chosen.value,
        fit: selectedAgent.value,
        notifyMe: notifyMe.value,
        stopOverCap: capped.value
    });
};
</script>

<style>
@import "./parity.css";
</style>
