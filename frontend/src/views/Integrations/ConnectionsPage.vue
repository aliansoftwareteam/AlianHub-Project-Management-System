<template>
    <div class="ah-page conn">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('ParityV2.connections') }}</div>
            <div class="ah-tabs" style="margin-left:8px">
                <button v-for="tab in tabs" :key="tab" type="button" class="ah-tab" :class="{ 'is-active': view === tab }" @click="view = tab">
                    {{ $t(`ParityV2.conn_tab_${tab}`) }}
                </button>
            </div>
            <div class="ah-toolbar__spacer"></div>
            <router-link class="ah-btn ah-btn--primary ah-btn--sm" :to="{ name: 'IntegrationsHub', params: { cid } }">
                <ShellIcon name="plus" :size="14" />{{ $t('ParityV2.connect') }}
            </router-link>
        </div>

        <div class="conn__body ah-scroll">
            <p class="parity-lead">{{ $t('ParityV2.connections_lead') }}</p>
            <p v-if="error" class="ah-field__error">{{ error }}</p>

            <div class="conn__grid">
                <article v-for="card in visible" :key="card.key" class="ah-card conn__card">
                    <div class="conn__top">
                        <span class="conn__mark" :class="`conn__mark--${card.mark}`">{{ card.glyph }}</span>
                        <div class="conn__id">
                            <div class="conn__name">
                                <strong>{{ card.name }}</strong>
                                <span v-if="card.badge" class="ah-chip ah-chip--mono conn__badge">{{ card.badge }}</span>
                            </div>
                            <div class="conn__sub">{{ card.sub }}</div>
                        </div>
                        <span class="ah-dot" :class="card.live ? 'ah-dot--ok' : 'ah-dot--warn'"></span>
                    </div>
                    <p class="conn__grants">{{ card.grants }}</p>
                    <div v-if="card.key === 'mcp-self'" class="conn__setup">
                        <div class="ah-label">{{ $t('ParityV2.mcp_setup') }}</div>
                        <code class="conn__code ah-mono">{{ mcpCommand }}</code>
                        <div class="conn__actions">
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="minting" @click="mint">
                                {{ minting ? $t('ParityV2.minting') : $t('ParityV2.mint_token') }}
                            </button>
                            <span class="ah-small">{{ $t('ParityV2.mcp_tools_count', { n: (mcpManifest.tools || []).length }) }}</span>
                        </div>
                        <div v-if="minted" class="conn__token">
                            <div class="ah-label">{{ $t('ParityV2.copy_now') }}</div>
                            <code class="conn__code ah-mono">{{ minted.token }}</code>
                            <p class="ah-small">{{ $t('ParityV2.token_once') }}</p>
                        </div>
                        <p v-if="mintError" class="ah-field__error">{{ mintError }}</p>
                    </div>
                </article>

                <article v-if="view === 'all' || view === 'apps'" class="conn__more">
                    <div class="conn__more-title">{{ availableNames }}</div>
                    <div class="conn__more-sub">{{ $t('ParityV2.or_any_mcp') }}</div>
                </article>
            </div>

            <section v-if="mcpManifest.never" class="ah-card conn__never">
                <div class="ah-card__head"><span class="ah-label">{{ $t('ParityV2.never_label') }}</span></div>
                <div class="ah-card__body">
                    <p class="parity-lead">{{ $t('ParityV2.never_body') }}</p>
                    <div class="conn__never-list">
                        <span v-for="item in mcpManifest.never" :key="item" class="ah-chip ah-chip--mono">{{ item }}</span>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

// Connections (13e). Only what this workspace can actually connect to is listed:
// the integrations catalogue the server serves, and the MCP server this product
// itself exposes. No aspirational connectors — a card that cannot be connected
// teaches people not to trust the page.
defineOptions({ name: "ConnectionsPage" });

const { t } = useI18n();
const route = useRoute();
const cid = computed(() => route.params.cid);

const tabs = ["all", "apps", "mcp", "agents"];
const view = ref("all");
const catalog = ref([]);
const connections = ref([]);
const mcpManifest = ref({});
const minted = ref(null);
const minting = ref(false);
const mintError = ref("");
const tokens = ref([]);
const error = ref("");

const MARKS = { github: "dark", gitlab: "orange", slack: "purple", google_calendar: "brand", microsoft_teams: "brand", zapier: "orange", custom_iframe: "grey" };

/* What an agent may read and do through each connection, stated per connection
 * type rather than in the abstract. */
const GRANTS = {
    slack: "ParityV2.grant_slack",
    github: "ParityV2.grant_github",
    gitlab: "ParityV2.grant_gitlab",
    google_calendar: "ParityV2.grant_calendar",
    microsoft_teams: "ParityV2.grant_teams",
    zapier: "ParityV2.grant_zapier",
    custom_iframe: "ParityV2.grant_iframe"
};

const connected = computed(() => {
    const byType = {};
    connections.value.forEach((c) => { byType[c.type] = c; });
    return byType;
});

const appCards = computed(() => catalog.value
    .filter((item) => connected.value[item.key])
    .map((item) => {
        const conn = connected.value[item.key];
        return {
            key: item.key,
            group: "apps",
            name: item.name,
            glyph: item.icon,
            mark: MARKS[item.key] || "grey",
            sub: conn.name && conn.name !== item.name ? conn.name : item.category,
            grants: t(GRANTS[item.key] || "ParityV2.grant_generic"),
            live: conn.enabled !== false && conn.status === "connected",
            badge: ""
        };
    }));

const mcpCard = computed(() => ({
    key: "mcp-self",
    group: "mcp",
    name: t("ParityV2.mcp_self_name"),
    glyph: "MCP",
    mark: "grey",
    sub: mcpUrl.value,
    grants: t("ParityV2.grant_mcp", { n: (mcpManifest.value.tools || []).length }),
    live: Boolean(mcpManifest.value.protocolVersion),
    badge: t("ParityV2.badge_served_here")
}));

const agentTokenCards = computed(() => tokens.value.map((token) => ({
    key: `token-${token._id}`,
    group: "agents",
    name: token.name || t("ParityV2.cli_agent"),
    glyph: "◉",
    mark: "grey",
    sub: t("ParityV2.token_sub", { mode: (token.agentAccount && token.agentAccount.mode) || "personal" }),
    grants: t("ParityV2.grant_token", { n: (token.projectIds || []).length || t("ParityV2.all_projects") }),
    live: token.active !== false,
    badge: t("ParityV2.badge_external")
})));

const visible = computed(() => {
    const all = [...appCards.value, mcpCard.value, ...agentTokenCards.value];
    if (view.value === "all") return all;
    return all.filter((c) => c.group === view.value);
});

const availableNames = computed(() => catalog.value
    .filter((item) => !connected.value[item.key])
    .map((item) => item.name)
    .join(" · ") || t("ParityV2.everything_connected"));

const apiBase = computed(() => String(env.API_URI || "").replace(/\/$/, ""));
const mcpUrl = computed(() => `${apiBase.value}/mcp?companyId=${cid.value || ""}`);
const mcpCommand = computed(() => `claude mcp add alianhub --transport http ${mcpUrl.value} --header "Authorization: Bearer <token>"`);

const mint = async () => {
    minting.value = true;
    mintError.value = "";
    try {
        const res = await apiRequest("post", env.MCP_TOKENS, { name: "CLI agent", mode: "personal", provider: "claude-code" });
        if (!res?.data?.status) { mintError.value = res?.data?.statusText || t("ParityV2.mint_failed"); return; }
        minted.value = res.data.data;
        await loadTokens();
    } catch (e) {
        mintError.value = e?.response?.data?.statusText || e.message;
    } finally {
        minting.value = false;
    }
};

const loadTokens = async () => {
    const res = await apiRequest("get", env.API_TOKENS);
    const rows = res?.data?.status ? (res.data.data || []) : [];
    tokens.value = rows.filter((row) => row.kind === "agent");
};

onMounted(async () => {
    try {
        const [cat, conns, manifest] = await Promise.all([
            apiRequest("get", `${env.INTEGRATIONS}/catalog`),
            apiRequest("get", `${env.INTEGRATIONS}/connections`),
            apiRequestWithoutCompnay("get", env.MCP_MANIFEST)
        ]);
        catalog.value = cat?.data?.status ? cat.data.data || [] : [];
        connections.value = conns?.data?.status ? conns.data.data || [] : [];
        mcpManifest.value = manifest?.data?.status ? manifest.data.data || {} : {};
        await loadTokens();
    } catch (e) {
        error.value = e?.response?.data?.statusText || e.message;
    }
});
</script>

<style>
@import "./connections.css";
</style>
