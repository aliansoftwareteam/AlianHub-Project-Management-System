<template>
    <div class="ah-page team">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('ParityV2.team') }}</div>
            <span class="parity-count">{{ headline }}</span>
            <div class="ah-toolbar__spacer"></div>
            <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" :disabled="!loaded" @click="showStandup = !showStandup">
                <ShellIcon name="ai" :size="14" />{{ $t('ParityV2.generate_standup') }}
            </button>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="!loaded" @click="showBalance = !showBalance">
                {{ $t('ParityV2.balance_workload') }}
            </button>
        </div>

        <div class="team__body ah-scroll">
            <p v-if="error" class="ah-field__error">{{ error }}</p>
            <p v-else-if="!loaded" class="ah-empty">{{ $t('ParityV2.loading') }}</p>

            <template v-else>
                <section v-if="showStandup" class="ah-card">
                    <div class="ah-card__head">
                        <span class="ah-h3">{{ $t('ParityV2.standup') }}</span>
                        <span class="parity-count">{{ standupTime }}</span>
                    </div>
                    <div class="ah-card__body">
                        <p v-if="!standup.lines.length" class="ah-empty">{{ $t('ParityV2.standup_empty') }}</p>
                        <p v-for="(line, i) in standup.lines" :key="i" class="team__standup-line">{{ line }}</p>
                        <p class="ah-small" style="margin-top:10px">{{ $t('ParityV2.standup_source') }}</p>
                    </div>
                </section>

                <section v-if="showBalance" class="ah-card">
                    <div class="ah-card__head"><span class="ah-h3">{{ $t('ParityV2.balance') }}</span></div>
                    <div class="ah-card__body">
                        <p v-if="standup.balance.over.length" class="team__standup-line">{{ $t('ParityV2.over_loaded', { names: standup.balance.over.join(', ') }) }}</p>
                        <p v-if="standup.balance.free.length" class="team__standup-line">{{ $t('ParityV2.has_room', { names: standup.balance.free.join(', ') }) }}</p>
                        <p v-if="!standup.balance.over.length && !standup.balance.free.length" class="ah-empty">{{ $t('ParityV2.balance_even') }}</p>
                    </div>
                </section>

                <section class="team__table">
                    <div class="team__row team__row--head">
                        <span>{{ $t('ParityV2.col_person') }}</span>
                        <span>{{ $t('ParityV2.col_now') }}</span>
                        <span>{{ $t('ParityV2.col_week') }}</span>
                        <span>{{ $t('ParityV2.col_status') }}</span>
                    </div>

                    <div v-for="person in people" :key="person.id" class="team__row" :class="{ 'team__row--away': person.status === 'away' }">
                        <span class="team__who">
                            <span class="ah-avatar">{{ person.name.slice(0, 1).toUpperCase() }}</span>
                            <span class="team__name">{{ person.name }}</span>
                        </span>
                        <span class="team__now">
                            <span v-if="person.timer" class="team__timer ah-mono"><span class="ah-dot ah-dot--ok"></span>{{ elapsed(person.timer.elapsedMs) }}</span>
                            <span>{{ nowLine(person) }}</span>
                        </span>
                        <span class="team__load">
                            <span class="team__bar"><span class="team__bar-fill" :class="loadClass(person.load)" :style="{ width: `${Math.min(100, person.load)}%` }"></span></span>
                            <span class="ah-mono team__load-num">{{ person.load }}%</span>
                        </span>
                        <span class="team__status">
                            <span class="ah-dot" :class="dotClass(person.status)"></span>{{ $t(`ParityV2.status_${person.status}`) }}
                        </span>
                    </div>

                    <div v-for="agent in agents" :key="agent.id" class="team__row team__row--agent">
                        <span class="team__who">
                            <AgentIdentity :name="agent.name" />
                        </span>
                        <span class="team__now">{{ agentNow(agent) }}</span>
                        <span class="ah-mono team__spend">{{ spendLine(agent) }}</span>
                        <span class="team__status">
                            <span class="ah-dot" :class="agent.status === 'running' ? 'ah-dot--ok' : ''"></span>{{ $t(`ParityV2.status_${agent.status}`) }}
                        </span>
                    </div>

                    <p v-if="!people.length && !agents.length" class="ah-empty">{{ $t('ParityV2.team_empty') }}</p>
                </section>

                <section class="ah-card">
                    <div class="ah-card__head">
                        <span class="ah-label">{{ $t('ParityV2.activity_live') }}</span>
                    </div>
                    <div class="ah-card__body">
                        <p v-if="!activity.length" class="ah-empty">{{ $t('ParityV2.no_activity') }}</p>
                        <div v-for="item in activity" :key="item.runId" class="team__activity">
                            <span class="ah-mono team__activity-at">{{ clock(item.at) }}</span>
                            <span>
                                <strong>{{ item.who }}</strong>
                                <span class="ah-chip ah-chip--agent ah-chip--mono team__tag">{{ $t('ParityV2.agent_tag') }}</span>
                                {{ item.what }}
                            </span>
                        </div>
                    </div>
                </section>

                <section v-if="onLeave.length" class="ah-card">
                    <div class="ah-card__head"><span class="ah-label">{{ $t('ParityV2.time_off') }}</span></div>
                    <div class="ah-card__body">
                        <div v-for="person in onLeave" :key="person.id" class="team__activity">
                            <span class="ah-mono team__activity-at">{{ String(person.pto.from).slice(5, 10) }}</span>
                            <span>{{ $t('ParityV2.pto_line', { name: person.name, to: String(person.pto.to).slice(0, 10) }) }}</span>
                        </div>
                    </div>
                </section>
            </template>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AgentIdentity from "@/views/Ai/AgentIdentity.vue";

// The Team board (13h). Every column is read from something that already
// happened — a running timer, an open task, an approved leave request, a live
// agent run — so nothing here is a status somebody has to remember to update.
defineOptions({ name: "TeamPage" });

const { t } = useI18n();

const people = ref([]);
const agents = ref([]);
const activity = ref([]);
const totals = ref({});
const standup = ref({ lines: [], balance: { over: [], free: [] } });
const loaded = ref(false);
const error = ref("");
const showStandup = ref(false);
const showBalance = ref(false);

const headline = computed(() => t("ParityV2.team_headline", {
    p: totals.value.people || 0,
    a: totals.value.agents || 0,
    load: totals.value.load || 0
}));

const onLeave = computed(() => people.value.filter((p) => p.pto));
const standupTime = computed(() => (standup.value.generatedAt ? clock(standup.value.generatedAt) : ""));

const elapsed = (ms) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    return `${h}:${m}`;
};

const clock = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

const nowLine = (person) => {
    if (person.status === "away" && person.pto) return t("ParityV2.pto_until", { date: String(person.pto.to).slice(0, 10) });
    if (person.nowOn) return person.nowOn;
    return t("ParityV2.nothing_in_progress");
};

const agentNow = (agent) => {
    if (agent.paused) return t("ParityV2.agent_paused");
    if (!agent.run) return t("ParityV2.agent_idle");
    return t("ParityV2.agent_on", { task: agent.run.taskKey || agent.run.taskName || agent.run.id.slice(-6), min: Math.round(agent.run.elapsedMs / 60000) });
};

const spendLine = (agent) => (agent.spend.cap ? `$${agent.spend.usd.toFixed(2)} / $${agent.spend.cap.toFixed(0)}` : `$${agent.spend.usd.toFixed(2)}`);

const loadClass = (load) => (load > 100 ? "team__bar-fill--over" : (load < 40 ? "team__bar-fill--low" : ""));
const dotClass = (status) => ({ working: "ah-dot--ok", available: "ah-dot--ok", away: "", offline: "" }[status] || "");

onMounted(async () => {
    try {
        const res = await apiRequest("get", env.AGENT_TEAM);
        if (!res?.data?.status) { error.value = res?.data?.statusText || t("ParityV2.team_failed"); return; }
        const data = res.data.data || {};
        people.value = data.people || [];
        agents.value = data.agents || [];
        activity.value = data.activity || [];
        totals.value = data.totals || {};
        standup.value = data.standup || { lines: [], balance: { over: [], free: [] } };
    } catch (e) {
        error.value = e?.response?.data?.statusText || e.message;
    } finally {
        loaded.value = true;
    }
});
</script>

<style>
@import "./style.css";
</style>
