<template>
    <div class="ah-page parity-page">
        <AiSidebar />
        <div class="parity-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('ParityV2.routing_title') }}</div>
                <span class="parity-count">{{ $t('ParityV2.n_selected', { n: selected.length }) }}</span>
                <div class="ah-toolbar__spacer"></div>
                <button type="button" class="ah-btn ah-btn--dark ah-btn--sm" :disabled="!selected.length" @click="propose">
                    {{ $t('ParityV2.route_to_agents') }}
                </button>
            </div>

            <div class="parity-page__body ah-scroll">
                <p class="parity-lead">{{ $t('ParityV2.routing_lead') }}</p>

                <section class="ah-card">
                    <div class="ah-card__head">
                        <span class="ah-h3">{{ $t('ParityV2.open_tasks') }}</span>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="toggleAll">
                            {{ selected.length === routable.length ? $t('ParityV2.clear_all') : $t('ParityV2.select_all') }}
                        </button>
                    </div>
                    <div class="ah-card__body">
                        <p v-if="loading" class="ah-empty">{{ $t('ParityV2.loading') }}</p>
                        <p v-else-if="!routable.length" class="ah-empty">{{ $t('ParityV2.nothing_open') }}</p>
                        <label v-for="item in routable" :key="item._id" class="route__row">
                            <input class="ah-check" type="checkbox" :value="String(item._id)" :checked="selected.includes(String(item._id))" @change="toggle(item)" />
                            <span class="route__title">{{ item.TaskName }}</span>
                            <span class="ah-mono ah-muted">{{ item.TaskKey || '' }}</span>
                        </label>
                    </div>
                </section>

                <section v-if="proposed && rows.length" class="ah-card">
                    <div class="ah-card__head">
                        <span class="ah-label">{{ $t('ParityV2.proposed_routing') }}</span>
                    </div>
                    <div class="ah-card__body">
                        <div v-for="row in rows" :key="row.taskId" class="route__row" :class="{ 'route__row--refused': !row.routed }">
                            <input v-if="row.routed" class="ah-check" type="checkbox" :checked="accepted.includes(row.taskId)" @change="acceptToggle(row)" />
                            <span v-else class="ah-dot ah-dot--warn"></span>
                            <span class="route__title">{{ row.title }}</span>
                            <span class="route__arrow">→</span>
                            <span class="route__to">
                                <template v-if="row.routed">
                                    <span class="ah-avatar ah-avatar--agent ah-avatar--sm"><ShellIcon name="agent" :size="11" /></span>
                                    <strong>{{ row.agent.name }}</strong>
                                </template>
                                <strong v-else>{{ row.refusal }}</strong>
                            </span>
                        </div>

                        <div class="route__foot">
                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!accepted.length || assigning" @click="assign">
                                {{ assigning ? $t('ParityV2.assigning') : $t('ParityV2.assign_n', { n: accepted.length }) }}
                            </button>
                            <span class="route__cost">{{ costLine }}</span>
                        </div>
                        <p v-if="assignError" class="ah-field__error" style="margin-top:8px">{{ assignError }}</p>
                    </div>
                </section>

                <section v-if="proposed && rows.length" class="ah-card route__rule">
                    <div class="ah-card__head">
                        <span class="ah-h3">{{ $t('ParityV2.stop_by_hand') }}</span>
                        <span class="ah-chip ah-chip--brand ah-chip--mono">{{ $t('ParityV2.rule_tag') }}</span>
                    </div>
                    <div class="ah-card__body">
                        <p class="route__rule-sentence">{{ ruleSentence }}</p>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="savingRule" @click="saveRule">
                                {{ savingRule ? $t('ParityV2.saving') : $t('ParityV2.save_rule') }}
                            </button>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="testing" @click="testRule">
                                {{ backtest ? $t('ParityV2.backtest_result', { n: backtest.matched, days: backtest.windowDays }) : $t('ParityV2.test_30_days') }}
                            </button>
                        </div>
                        <p v-if="ruleErrors.length" class="ah-field__error">{{ ruleErrors[0] }}</p>
                        <p v-if="ruleSaved" class="parity-lead">{{ $t('ParityV2.rule_saved') }}</p>
                        <p class="route__note">{{ $t('ParityV2.rules_live_with') }}</p>
                    </div>
                </section>

                <p class="parity-lead">{{ $t('ParityV2.router_trust') }}</p>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AiSidebar from "./AiSidebar.vue";
import { useParity } from "./useParity";
import { routeTasks, routingTotals } from "./agentFit";

// Bulk routing (30b). The tasks it refuses to route are the point, so refusals
// are rendered with the same weight as the assignments.
defineOptions({ name: "AgentRouting" });

const { t } = useI18n();
const $toast = useToast();
const { agents, registryManifest, routable, runs, loadAgents, loadRegistry, loadRuns, loadRoutable, startRun } = useParity();

const loading = ref(true);
const selected = ref([]);
const accepted = ref([]);
const proposed = ref(false);
const assigning = ref(false);
const assignError = ref("");
const savingRule = ref(false);
const testing = ref(false);
const ruleSaved = ref(false);
const ruleErrors = ref([]);
const compiled = ref(null);
const backtest = ref(null);

const rows = computed(() => routeTasks({
    tasks: routable.value.filter((task) => selected.value.includes(String(task._id))),
    agents: agents.value,
    runs: runs.value,
    registryActions: registryManifest.value.actions || [],
    never: registryManifest.value.never || []
}));

const totals = computed(() => routingTotals(rows.value));

const costLine = computed(() => {
    const priced = totals.value.priced ? t("ParityV2.about_usd", { usd: totals.value.usd.toFixed(2) }) : t("ParityV2.cost_unknown");
    return t("ParityV2.route_cost_line", { cost: priced, n: totals.value.forPeople });
});

const propose = () => {
    proposed.value = true;
    accepted.value = rows.value.filter((r) => r.routed).map((r) => r.taskId);
};

const toggle = (item) => {
    const id = String(item._id);
    selected.value = selected.value.includes(id) ? selected.value.filter((v) => v !== id) : selected.value.concat(id);
    accepted.value = accepted.value.filter((v) => selected.value.includes(v));
};

const toggleAll = () => {
    selected.value = selected.value.length === routable.value.length ? [] : routable.value.map((r) => String(r._id));
};

const acceptToggle = (row) => {
    accepted.value = accepted.value.includes(row.taskId) ? accepted.value.filter((v) => v !== row.taskId) : accepted.value.concat(row.taskId);
};

const assign = async () => {
    assigning.value = true;
    assignError.value = "";
    let done = 0;
    try {
        for (const row of rows.value.filter((r) => r.routed && accepted.value.includes(r.taskId))) {
            // Sequential on purpose: each run is a spend decision, and a failure
            // half way through must leave the rest unstarted rather than racing.
            // eslint-disable-next-line no-await-in-loop
            await startRun({ agentId: row.agent.agentId, taskId: row.taskId, trigger: "assignment", note: row.agent.reason });
            done += 1;
        }
        $toast.success(t("ParityV2.routed_n", { n: done }), { position: "top-right" });
        accepted.value = [];
    } catch (error) {
        assignError.value = t("ParityV2.routed_partial", { n: done, error: error.message });
    } finally {
        assigning.value = false;
    }
};

/* The rule the router offers is the routing decision written down: the kind of
 * work it just matched, and the agent it matched it to. */
const ruleSentence = computed(() => {
    const first = rows.value.find((r) => r.routed);
    if (!first) return t("ParityV2.no_rule_yet");
    const agent = agents.value.find((a) => String(a._id) === first.agent.agentId) || {};
    const skill = (agent.skills || [])[0] || "qa-review";
    return `When a task is created, if the title contains "${first.work.kind}", run the ${String(skill).replace(/[^a-z0-9-]/gi, "-").toLowerCase()} agent.`;
});

const compile = async () => {
    const res = await apiRequest("post", env.AUTOMATIONS_COMPILE, { sentence: ruleSentence.value, name: t("ParityV2.rule_name") });
    if (!res?.data?.status) { ruleErrors.value = [res?.data?.statusText || t("ParityV2.compile_failed")]; return null; }
    ruleErrors.value = res.data.data.errors || [];
    compiled.value = res.data.data.rule;
    return compiled.value;
};

const testRule = async () => {
    testing.value = true;
    try {
        const rule = await compile();
        if (!rule) return;
        const res = await apiRequest("post", env.AUTOMATIONS_BACKTEST, { rule });
        if (res?.data?.status) backtest.value = res.data.data;
    } finally {
        testing.value = false;
    }
};

const saveRule = async () => {
    savingRule.value = true;
    ruleSaved.value = false;
    try {
        const rule = await compile();
        if (!rule) return;
        const res = await apiRequest("post", env.AUTOMATIONS_V2, { ...rule, name: t("ParityV2.rule_name"), enabled: false });
        if (!res?.data?.status) { ruleErrors.value = res?.data?.errors || [res?.data?.statusText]; return; }
        ruleSaved.value = true;
    } finally {
        savingRule.value = false;
    }
};

onMounted(async () => {
    await Promise.all([loadAgents(), loadRegistry(), loadRuns(), loadRoutable()]);
    loading.value = false;
    selected.value = routable.value.slice(0, 8).map((r) => String(r._id));
});
</script>

<style>
@import "./parity.css";
</style>
