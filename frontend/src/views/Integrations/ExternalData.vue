<template>
    <div class="ah-page xd">
        <header class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('ProvenanceV2.ext_title') }}</div>
            <span class="ah-mono xd__meta">{{ $t('ProvenanceV2.ext_meta', { sources: liveSources.length, agents: agentCount }) }}</span>
            <div class="ah-toolbar__spacer"></div>
            <router-link class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'IntegrationsHub', params: { cid } }">
                <ShellIcon name="plus" :size="14" />{{ $t('ProvenanceV2.ext_connect') }}
            </router-link>
        </header>

        <div class="xd__body ah-scroll">
            <p v-if="error" class="ah-field__error">{{ error }}</p>

            <section class="ah-card xd__card">
                <div class="ah-card__head">
                    <strong>{{ $t('ProvenanceV2.ext_sources') }}</strong>
                    <span class="ah-small ah-muted xd__sub">{{ $t('ProvenanceV2.ext_sources_sub') }}</span>
                </div>
                <div class="ah-card__body xd__rows">
                    <div v-for="source in sources" :key="source.key" class="xd__row" :class="{ 'xd__row--off': !source.live }">
                        <span class="xd__mark">{{ source.glyph }}</span>
                        <div class="xd__id">
                            <div class="xd__name">{{ source.name }}</div>
                            <div class="xd__desc">{{ source.reads }}</div>
                        </div>
                        <span v-if="source.live" class="xd__state">
                            <span class="ah-dot ah-dot--ok"></span>{{ source.since }}
                        </span>
                        <router-link v-else class="xd__link" :to="{ name: 'IntegrationsHub', params: { cid } }">{{ $t('ProvenanceV2.ext_not_connected') }}</router-link>
                    </div>
                    <p class="xd__note">{{ $t('ProvenanceV2.ext_no_mirror') }}</p>
                </div>
            </section>

            <section class="ah-card xd__card xd__card--agents">
                <div class="ah-card__head">
                    <strong>{{ $t('ProvenanceV2.ext_hand_off') }}</strong>
                    <span class="ah-chip ah-chip--brand ah-chip--mono xd__tag">{{ $t('ProvenanceV2.ext_external') }}</span>
                </div>
                <div class="ah-card__body xd__rows">
                    <div class="xd__row xd__row--bordered">
                        <span class="xd__mark xd__mark--dark">MCP</span>
                        <div class="xd__id">
                            <div class="xd__name">{{ $t('ProvenanceV2.ext_mcp_name') }}</div>
                            <div class="xd__desc ah-mono">{{ mcpUrl }}</div>
                        </div>
                        <span class="ah-small ah-muted">{{ $t('ProvenanceV2.ext_tools', { n: tools.length }) }}</span>
                    </div>
                    <div v-if="tools.length" class="xd__tools">
                        <span v-for="tool in tools" :key="tool" class="ah-chip ah-chip--mono">{{ tool }}</span>
                    </div>

                    <div v-if="account" class="xd__row xd__row--bordered">
                        <span class="xd__mark xd__mark--dark">◉</span>
                        <div class="xd__id">
                            <div class="xd__name">{{ account.label || account.provider }}</div>
                            <div class="xd__desc">{{ $t('ProvenanceV2.ext_account_sub', { mode: account.mode }) }}</div>
                        </div>
                        <span class="ah-small ah-muted">{{ $t('ProvenanceV2.ext_month', { tasks: summary.tasksWorked || 0, hours: summary.agentHours || 0, prs: summary.prsOpened || 0 }) }}</span>
                    </div>
                    <div v-else class="xd__row xd__row--bordered">
                        <span class="xd__mark">◉</span>
                        <div class="xd__id">
                            <div class="xd__name">{{ $t('ProvenanceV2.ext_no_account') }}</div>
                            <div class="xd__desc">{{ $t('ProvenanceV2.ext_no_account_sub') }}</div>
                        </div>
                        <router-link v-if="hasConnections" class="xd__link" :to="{ name: 'Connections', params: { cid } }">{{ $t('ProvenanceV2.ext_link_account') }}</router-link>
                    </div>

                    <div v-for="agent in agents" :key="agent._id" class="xd__row xd__row--bordered">
                        <span class="xd__mark xd__mark--agent">◉</span>
                        <div class="xd__id">
                            <div class="xd__name">{{ agent.name }}</div>
                            <div class="xd__desc">{{ $t('ProvenanceV2.ext_agent_sub', { account: agent.account || 'workspace' }) }}</div>
                        </div>
                        <span v-if="agent.paused" class="ah-chip ah-chip--warn">{{ $t('ProvenanceV2.ext_paused') }}</span>
                    </div>

                    <div v-if="recentRuns.length" class="xd__runs">
                        <div v-for="run in recentRuns" :key="run._id" class="xd__run">
                            <strong>{{ $t('ProvenanceV2.ext_handed', { agent: run.agentName || $t('ProvenanceV2.an_agent'), when: fromNow(run.startedAt) }) }}</strong>
                        </div>
                        <p class="xd__run-note">{{ $t('ProvenanceV2.ext_handed_note') }}</p>
                    </div>

                    <div v-if="never.length" class="xd__never">
                        <div class="ah-label">{{ $t('ProvenanceV2.ext_never') }}</div>
                        <div class="xd__tools">
                            <span v-for="item in never" :key="item" class="ah-chip ah-chip--mono">{{ item }}</span>
                        </div>
                    </div>

                    <p class="xd__note">{{ $t('ProvenanceV2.ext_same_treatment') }}</p>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import moment from "moment";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import "./externalData.css";

// External data & coding agents (25e). Everything on this page is something the
// workspace can actually reach today: the integrations catalogue the server
// serves, the MCP server this product exposes, and the agents that hold an
// account here. Nothing is mirrored into AlianHub — a linked row stays in its
// source — so there is no sync status to invent.
defineOptions({ name: "ExternalDataPage" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const cid = computed(() => route.params.cid);

const catalog = ref([]);
const connections = ref([]);
const manifest = ref({});
const agents = ref([]);
const account = ref(null);
const summary = ref({});
const recentRuns = ref([]);
const error = ref("");

const hasConnections = computed(() => router.hasRoute("Connections"));
const tools = computed(() => (manifest.value.tools || []).map((tool) => tool.name));
const never = computed(() => manifest.value.never || []);
const agentCount = computed(() => agents.value.length + (account.value ? 1 : 0));

const apiBase = computed(() => String(env.API_URI || "").replace(/\/$/, ""));
const mcpUrl = computed(() => `${apiBase.value}/mcp?companyId=${cid.value || ""}`);

const fromNow = (date) => (date ? moment(date).fromNow() : "");

const connectedBy = computed(() => {
    const byType = {};
    connections.value.forEach((conn) => { byType[conn.type] = conn; });
    return byType;
});

const sources = computed(() => catalog.value.map((item) => {
    const conn = connectedBy.value[item.key];
    const live = Boolean(conn && conn.enabled !== false && conn.status === "connected");
    return {
        key: item.key,
        name: conn && conn.name && conn.name !== item.name ? `${item.name} · ${conn.name}` : item.name,
        glyph: item.icon,
        reads: item.description,
        live,
        since: conn && conn.connectedAt ? fromNow(conn.connectedAt) : t("ProvenanceV2.ext_connected")
    };
}));

const liveSources = computed(() => sources.value.filter((source) => source.live));

onMounted(async () => {
    try {
        const [cat, conns, mcp, agentList, acct, runs] = await Promise.all([
            apiRequest("get", `${env.INTEGRATIONS}/catalog`).catch(() => null),
            apiRequest("get", `${env.INTEGRATIONS}/connections`).catch(() => null),
            apiRequestWithoutCompnay("get", env.MCP_MANIFEST).catch(() => null),
            apiRequest("get", env.AGENTS).catch(() => null),
            apiRequest("get", env.AGENT_ACCOUNT).catch(() => null),
            apiRequest("get", `${env.AGENT_RUNS}?limit=3`).catch(() => null)
        ]);
        catalog.value = cat?.data?.status ? cat.data.data || [] : [];
        connections.value = conns?.data?.status ? conns.data.data || [] : [];
        manifest.value = mcp?.data?.status ? mcp.data.data || {} : {};
        agents.value = agentList?.data?.status ? agentList.data.data || [] : [];
        account.value = acct?.data?.status ? acct.data.data.account || null : null;
        summary.value = acct?.data?.status ? acct.data.data.summary || {} : {};
        recentRuns.value = runs?.data?.status ? (runs.data.data || []).slice(0, 3) : [];
    } catch (e) {
        error.value = e?.response?.data?.statusText || e.message;
    }
});
</script>
