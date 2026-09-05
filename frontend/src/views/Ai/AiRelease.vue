<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Pipeline.release_title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <span v-if="sinceLabel" class="ah-mono rel-since">{{ sinceLabel }}</span>
            </div>

            <div v-if="loading" class="ai-page__body"><div class="ah-empty">{{ $t('Pipeline.loading') }}</div></div>
            <div v-else-if="loadError" class="ai-page__body">
                <EmptyState :title="$t('Ai.load_failed')" :message="loadError" :action-label="$t('Ai.retry')" @action="load" />
            </div>

            <div v-else class="rel">
                <div class="rel__main ah-scroll">
                    <div class="rel__head">
                        <h1 class="ah-h1">{{ candidateName }}</h1>
                        <span class="ah-mono rel__meta">{{ candidateMeta }}</span>
                        <span v-if="staging.last" class="ah-chip ah-chip--warn">{{ $t('Pipeline.on_staging') }}</span>
                    </div>

                    <div class="rel__stats">
                        <div class="rel-stat">
                            <div class="ah-label">{{ $t('Pipeline.stat_done') }}</div>
                            <div class="rel-stat__n">{{ counts.done }}</div>
                            <div class="ah-small">{{ $t('Pipeline.stat_done_sub', { n: counts.agentAssisted }) }}</div>
                        </div>
                        <div class="rel-stat">
                            <div class="ah-label">{{ $t('Pipeline.stat_agents') }}</div>
                            <div class="rel-stat__n">{{ counts.agents }}</div>
                            <div class="ah-small">{{ $t('Pipeline.stat_agents_sub', { n: counts.projects }) }}</div>
                        </div>
                        <div class="rel-stat">
                            <div class="ah-label">{{ $t('Pipeline.stat_ci') }}</div>
                            <div class="rel-stat__n rel-stat__n--none">{{ $t('Pipeline.not_connected') }}</div>
                            <div class="ah-small">{{ $t('Pipeline.stat_ci_sub') }}</div>
                        </div>
                        <div class="rel-stat">
                            <div class="ah-label">{{ $t('Pipeline.stat_staging') }}</div>
                            <div class="rel-stat__n" :class="{ 'rel-stat__n--none': !staging.last }">{{ stagingAge }}</div>
                            <div class="ah-small">{{ stagingWho }}</div>
                        </div>
                    </div>

                    <section class="ah-card rel-card">
                        <div class="rel-card__head">
                            <span class="ah-avatar ah-avatar--agent ah-avatar--sm"><ShellIcon name="agent" :size="11" /></span>
                            <strong>{{ $t('Pipeline.notes_title') }}</strong>
                            <span v-if="notesDraft" class="ah-chip ah-chip--warn ah-chip--mono">{{ $t('Pipeline.draft') }}</span>
                        </div>
                        <div class="ah-card__body">
                            <template v-if="notesDraft">
                                <p class="rel-notes">{{ notesDraft.what }}</p>
                                <p class="ah-small">{{ notesDraft.why }}</p>
                                <router-link class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'AiInbox', params: { cid: companyId } }">
                                    {{ $t('Pipeline.review_draft') }}
                                </router-link>
                            </template>
                            <template v-else>
                                <p class="ah-small">{{ $t('Pipeline.notes_none') }}</p>
                                <ul class="rel-tasks">
                                    <li v-for="task in tasks.slice(0, 8)" :key="task._id" class="rel-task">
                                        <span class="ah-mono rel-task__key">{{ task.taskKey || '—' }}</span>
                                        <span class="rel-task__name">{{ task.name }}</span>
                                        <span v-if="task.agentAssisted" class="ah-chip ah-chip--agent ah-chip--mono">{{ $t('Pipeline.agent_worked') }}</span>
                                    </li>
                                </ul>
                                <p v-if="!tasks.length" class="ah-small">{{ $t('Pipeline.no_done_tasks') }}</p>
                            </template>
                        </div>
                    </section>

                    <section class="ah-card rel-gate">
                        <div class="rel-card__head">
                            <strong>{{ $t('Pipeline.staging_title') }}</strong>
                            <span class="ah-chip ah-chip--warn ah-chip--mono">{{ gateChip }}</span>
                        </div>
                        <div class="ah-card__body">
                            <p class="ah-small">{{ stagingRule }}</p>
                            <div v-for="p in staging.proposals.slice(0, 4)" :key="p._id" class="rel-proposal">
                                <span class="ah-avatar ah-avatar--agent ah-avatar--sm"><ShellIcon name="agent" :size="10" /></span>
                                <span class="rel-proposal__what">{{ p.what }}</span>
                                <span class="ah-chip" :class="p.status === 'pending' ? 'ah-chip--warn' : 'ah-chip--ok'">{{ p.status }}</span>
                                <router-link
                                    v-if="p.status === 'pending'"
                                    class="ah-btn ah-btn--primary ah-btn--sm"
                                    :to="{ name: 'AiInbox', params: { cid: companyId } }"
                                >{{ $t('Pipeline.approve_in_inbox') }}</router-link>
                            </div>
                            <p v-if="!staging.proposals.length" class="pipe-none">{{ $t('Pipeline.staging_none') }}</p>
                        </div>
                    </section>

                    <section class="ah-card rel-prod">
                        <div class="rel-card__head">
                            <strong class="rel-prod__title">{{ $t('Pipeline.prod_title') }}</strong>
                            <span class="ah-chip ah-chip--danger ah-chip--mono">{{ $t('Pipeline.human_only') }}</span>
                        </div>
                        <div class="ah-card__body">
                            <ul class="rel-checks">
                                <li v-for="check in checks" :key="check.key" class="rel-check" :class="`rel-check--${check.state}`">
                                    <span class="rel-check__box"><ShellIcon v-if="check.state === 'ok'" name="check" :size="10" /></span>
                                    <span>{{ check.label }}</span>
                                </li>
                            </ul>

                            <div class="rel-prod__stop">
                                <ShellIcon name="lock" :size="15" />
                                <div>
                                    <div class="rel-prod__stop-title">{{ $t('Pipeline.no_target_title') }}</div>
                                    <p class="ah-small">{{ $t('Pipeline.no_target_body') }}</p>
                                    <p class="ah-small">{{ neverLine }}</p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <p class="rel-foot">{{ $t('Pipeline.rel_foot') }}</p>
                </div>

                <aside class="rel__side ah-scroll">
                    <div class="ah-label">{{ $t('Pipeline.environments') }}</div>
                    <div class="rel-env">
                        <span class="ah-dot" :class="production.offeredToAgents ? 'ah-dot--danger' : 'ah-dot--ok'"></span>
                        <div>
                            <div class="rel-env__name">{{ $t('Pipeline.env_production') }}</div>
                            <div class="ah-mono rel-env__meta">{{ productionLine }}</div>
                        </div>
                    </div>
                    <div class="rel-env" :class="{ 'rel-env--warn': staging.last }">
                        <span class="ah-dot" :class="staging.last ? 'ah-dot--warn' : ''"></span>
                        <div>
                            <div class="rel-env__name">{{ $t('Pipeline.env_staging') }}</div>
                            <div class="ah-mono rel-env__meta">{{ stagingLine }}</div>
                        </div>
                    </div>

                    <div class="ah-label rel-side__label">{{ $t('Pipeline.deploy_history') }}</div>
                    <div v-for="row in history" :key="row.key" class="rel-hist" :class="{ 'rel-hist--refused': row.refused }">
                        <span class="ah-mono rel-hist__at">{{ row.at }}</span>
                        <span class="rel-hist__what">{{ row.what }}</span>
                    </div>
                    <p v-if="!history.length" class="pipe-none">{{ historyEmpty }}</p>

                    <div class="ah-label rel-side__label">{{ $t('Pipeline.code_providers') }}</div>
                    <div v-for="provider in production.codeProviders || []" :key="provider.key" class="rel-provider">
                        <span class="ah-dot" :class="provider.connected ? 'ah-dot--ok' : ''"></span>
                        <span>{{ provider.name }}</span>
                        <span class="ah-mono rel-provider__state">{{ provider.connected ? $t('Pipeline.connected') : $t('Pipeline.not_connected') }}</span>
                    </div>

                    <p class="rel-side__note">{{ $t('Pipeline.side_note') }}</p>
                </aside>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import AiSidebar from "./AiSidebar.vue";
import { useShipping } from "./useShipping";
import { reasonOf } from "./useAgents";

// 28c — the release candidate. Staging is a proposal an Owner or Admin approves;
// production is not offered to any agent, and there is no deploy integration in
// the catalog, so the control states what is missing instead of pretending.
defineOptions({ name: "AiRelease" });

const { t } = useI18n();
const companyId = inject("$companyId");
const { release, changelog, loadRelease } = useShipping();
const loading = ref(true);
const loadError = ref("");

const counts = computed(() => release.value?.counts || { done: 0, agentAssisted: 0, agents: 0, projects: 0 });
const tasks = computed(() => release.value?.tasks || []);
const staging = computed(() => release.value?.staging || { actions: [], proposals: [], pending: 0, last: null });
const production = computed(() => release.value?.production || { offeredToAgents: false, never: [], deployTargets: [], codeProviders: [] });
const audit = computed(() => release.value?.audit || { visible: false, refusals: [] });

const lastRelease = computed(() => (changelog.value?.releases || [])[0] || null);
const sinceLabel = computed(() => (release.value?.since ? t("Pipeline.since", { at: moment(release.value.since).format("D MMM YYYY") }) : ""));
const candidateName = computed(() => t("Pipeline.candidate", { version: changelog.value?.currentVersion || "—" }));
const candidateMeta = computed(() => t("Pipeline.candidate_meta", {
    last: lastRelease.value?.version || "—",
    n: counts.value.done
}));

const notesDraft = computed(() => (staging.value.proposals || []).find((p) => (p.actions || []).includes("page.draft") && p.status === "pending") || null);

const stagingAge = computed(() => (staging.value.last?.decidedAt ? moment(staging.value.last.decidedAt).fromNow(true) : t("Pipeline.none")));
const stagingWho = computed(() => (staging.value.last ? t("Pipeline.staging_by", { agent: staging.value.last.agentName }) : t("Pipeline.staging_never")));
const stagingLine = computed(() => (staging.value.last
    ? `${moment(staging.value.last.decidedAt).format("D MMM HH:mm")} · ${staging.value.last.status}`
    : t("Pipeline.env_none")));
const productionLine = computed(() => (changelog.value?.currentVersion
    ? t("Pipeline.env_prod_meta", { version: changelog.value.currentVersion })
    : t("Pipeline.env_none")));

const gateChip = computed(() => {
    const gated = staging.value.actions || [];
    if (!gated.length) return t("Pipeline.gate_none");
    return gated[0].gate === "owner_admin" ? t("Pipeline.gate_owner_admin") : gated[0].gate || t("Pipeline.gate_human");
});

const stagingRule = computed(() => {
    const gated = staging.value.actions || [];
    if (!gated.length) return t("Pipeline.staging_rule_none");
    return t("Pipeline.staging_rule", { keys: gated.map((a) => a.key).join(", "), gate: gateChip.value });
});

const neverLine = computed(() => t("Pipeline.never_line", { keys: (production.value.never || []).filter((k) => /deploy|merge|git/i.test(k)).join(", ") || "—" }));

const checks = computed(() => [
    { key: "done", state: counts.value.done ? "ok" : "todo", label: t("Pipeline.check_done", { n: counts.value.done }) },
    { key: "human", state: "ok", label: t("Pipeline.check_human") },
    { key: "staging", state: staging.value.last ? "ok" : "todo", label: staging.value.last ? t("Pipeline.check_staging_ok", { at: moment(staging.value.last.decidedAt).fromNow() }) : t("Pipeline.check_staging_todo") },
    { key: "ci", state: "unknown", label: t("Pipeline.check_ci") }
]);

const history = computed(() => {
    const rows = (staging.value.proposals || [])
        .filter((p) => p.decidedAt)
        .slice(0, 5)
        .map((p) => ({
            key: p._id,
            at: moment(p.decidedAt).fromNow(true),
            what: t("Pipeline.hist_staging", { agent: p.agentName, status: p.status }),
            refused: p.status === "declined"
        }));
    const refusals = (audit.value.refusals || [])
        .filter((r) => /deploy|merge/i.test(r.action))
        .slice(0, 3)
        .map((r) => ({
            key: r._id,
            at: moment(r.at).fromNow(true),
            what: t("Pipeline.hist_refused", { who: r.actorName || "—", action: r.action }),
            refused: true
        }));
    return [...rows, ...refusals];
});

const historyEmpty = computed(() => (audit.value.visible ? t("Pipeline.hist_none") : t("Pipeline.hist_none_restricted")));

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        await loadRelease();
    } catch (error) {
        loadError.value = reasonOf(error, "Ai.load_failed");
    } finally {
        loading.value = false;
    }
};

onMounted(load);
</script>

<style>
@import "./style.css";
@import "./shipping.css";
</style>
