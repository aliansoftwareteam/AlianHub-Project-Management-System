<template>
    <div class="ah-page apc">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('AppConnections.title') }}</div>
        </div>

        <div class="apc__body ah-scroll">
            <p class="ah-small">{{ $t('AppConnections.lead') }}</p>
            <p v-if="enabled && !canManage" class="ah-small">{{ $t('AppConnections.read_only') }}</p>
            <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>
            <p v-if="notice" class="ah-small" role="status" data-notice>{{ notice }}</p>
            <p v-if="loaded && !enabled" class="ah-card apc__off">{{ $t('AppConnections.off') }}</p>

            <div v-if="enabled" class="apc__list">
                <article v-for="app in apps" :key="app.key" class="ah-card apc__card" :data-app="app.key">
                    <header class="apc__top">
                        <span class="apc__icon" aria-hidden="true">{{ app.icon }}</span>
                        <div class="apc__id">
                            <strong class="apc__name">{{ app.name }}</strong>
                            <span class="ah-small">{{ $t(`AppConnections.desc_${app.key}`) }}</span>
                        </div>
                        <button v-if="canManage && (!app.connections.length || app.multiple)" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openConnect(app)">
                            {{ $t('AppConnections.connect') }}
                        </button>
                    </header>

                    <p v-if="!canManage && app.key === 'github' && !app.oneClick && !app.connections.length" class="ah-small" data-ask-admin>{{ $t('AppConnections.github_ask_admin') }}</p>

                    <section v-if="canManage && connecting === app.key && app.setup && !usingToken" class="apc__setup" data-github-setup>
                        <strong class="apc__name">{{ $t('AppConnections.github_setup_title') }}</strong>
                        <ol class="apc__steps">
                            <li>
                                <span>{{ $t('AppConnections.github_setup_register') }}</span>
                                <div v-for="entry in setupUrls(app)" :key="entry.key" class="apc__url">
                                    <span class="ah-label">{{ $t(`AppConnections.github_setup_${entry.key}`) }}</span>
                                    <div class="apc__row">
                                        <code class="ah-mono apc__code" :data-url="entry.key">{{ entry.value }}</code>
                                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="copy(entry.value)">
                                            {{ copied === entry.value ? $t('AppConnections.copied') : $t('AppConnections.copy') }}
                                        </button>
                                    </div>
                                </div>
                            </li>
                            <li>{{ $t('AppConnections.github_setup_env', { idName: 'GITHUB_CONNECT_CLIENT_ID', secretName: 'GITHUB_CONNECT_CLIENT_SECRET' }) }}</li>
                            <li>{{ $t('AppConnections.github_setup_restart') }}</li>
                        </ol>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm apc__alt" data-use-token @click="usingToken = true">{{ $t('AppConnections.github_use_token') }}</button>
                    </section>

                    <form v-if="canManage && connecting === app.key && (!app.setup || usingToken)" class="apc__form" @submit.prevent="connect(app)">
                        <label v-for="field in app.fields" :key="field.key" class="ah-field">
                            <span class="ah-label">{{ $t(`AppConnections.field_${app.key}_${field.key}`) }}</span>
                            <input v-model="values[field.key]" class="ah-input" :type="field.secret ? 'password' : 'text'" :required="field.required" autocomplete="off" />
                        </label>
                        <div class="apc__actions">
                            <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy">{{ $t('AppConnections.save') }}</button>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="connecting = ''">{{ $t('AppConnections.cancel') }}</button>
                        </div>
                    </form>

                    <section v-for="conn in app.connections" :key="conn.id" class="apc__conn">
                        <div class="apc__row">
                            <span class="ah-chip" :class="chipOf(conn)">{{ $t(`AppConnections.state_${stateOf(conn)}`) }}</span>
                            <span v-if="conn.target" class="ah-chip ah-chip--mono">{{ conn.target }}</span>
                            <span class="apc__spacer"></span>
                            <template v-if="canManage">
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="toggle(conn)">
                                    {{ conn.enabled ? $t('AppConnections.pause') : $t('AppConnections.resume') }}
                                </button>
                                <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy" @click="disconnect(conn)">
                                    {{ confirming === conn.id ? $t('AppConnections.confirm_disconnect') : $t('AppConnections.disconnect') }}
                                </button>
                            </template>
                        </div>

                        <div v-if="blockedHostOf(conn)" class="apc__egress" role="status" data-egress-blocked>
                            <span>{{ $t('AppConnections.egress_blocked', { host: blockedHostOf(conn) }) }}</span>
                            <div v-if="instanceOwner" class="apc__actions">
                                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" data-allow-host @click="allowHost(app, conn)">
                                    {{ $t('AppConnections.egress_allow', { host: blockedHostOf(conn) }) }}
                                </button>
                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-egress-settings @click="openEgress">{{ $t('AppConnections.egress_settings') }}</button>
                            </div>
                            <span v-else data-ask-owner>{{ $t('AppConnections.egress_ask_owner', { host: blockedHostOf(conn) }) }}</span>
                        </div>

                        <div v-if="canManage && pickable(app, conn)" class="apc__projects">
                            <span v-if="!conn.target" class="ah-small">{{ $t('AppConnections.repo_needed') }}</span>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="openRepos(conn)">
                                {{ conn.target ? $t('AppConnections.change_repo') : $t('AppConnections.pick_repo') }}
                            </button>
                            <div v-if="choosingRepo === conn.id" class="apc__picker">
                                <span class="ah-label">{{ $t('AppConnections.repo_label') }}</span>
                                <input v-model="repoFilter" class="ah-input" type="search" :placeholder="$t('AppConnections.repo_filter')" :aria-label="$t('AppConnections.repo_filter')" data-repo-filter />
                                <div class="apc__repos" data-repo-list>
                                    <label v-for="r in shownRepos" :key="r.fullName" class="apc__pick">
                                        <input v-model="pickedRepo" type="radio" name="apc-repo" :value="r.fullName" />
                                        <span>{{ r.fullName }}</span>
                                    </label>
                                    <span v-if="reposLoaded && !repos.length" class="ah-small">{{ $t('AppConnections.no_repos') }}</span>
                                    <span v-else-if="reposLoaded && !shownRepos.length" class="ah-small" data-no-match>{{ $t('AppConnections.no_repo_match') }}</span>
                                </div>
                                <div class="apc__actions" data-repo-actions>
                                    <button v-if="reposMore" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="loadRepos(conn, reposPage + 1)">{{ $t('AppConnections.more_repos') }}</button>
                                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !pickedRepo" @click="saveRepo(conn)">{{ $t('AppConnections.save') }}</button>
                                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="choosingRepo = ''">{{ $t('AppConnections.cancel') }}</button>
                                </div>
                            </div>
                        </div>

                        <dl v-if="app.syncs" class="apc__facts">
                            <div>
                                <dt class="ah-label">{{ $t('AppConnections.last_sync') }}</dt>
                                <dd>{{ conn.lastSyncAt ? when(conn.lastSyncAt) : $t('AppConnections.never') }}</dd>
                            </div>
                            <div>
                                <dt class="ah-label">{{ $t('AppConnections.last_error') }}</dt>
                                <dd :class="{ 'apc__error': conn.lastError }">{{ lastErrorOf(conn) || $t('AppConnections.none') }}</dd>
                            </div>
                            <div v-if="conn.nextAttemptAt">
                                <dt class="ah-label">{{ $t('AppConnections.retry_at') }}</dt>
                                <dd>{{ when(conn.nextAttemptAt) }}</dd>
                            </div>
                        </dl>

                        <div v-if="app.syncs" class="apc__projects">
                            <span class="ah-label">{{ $t('AppConnections.projects') }}</span>
                            <div class="apc__chips">
                                <span v-for="p in conn.projects" :key="p.id" class="ah-chip ah-chip--brand">{{ p.hidden ? $t('AppConnections.hidden_project') : p.name }}</span>
                                <span v-if="!canManage && conn.hiddenProjects" class="ah-small">{{ $t('AppConnections.hidden_projects', { count: conn.hiddenProjects }, conn.hiddenProjects) }}</span>
                                <span v-if="!conn.projects.length && !conn.hiddenProjects" class="ah-small">{{ $t('AppConnections.no_projects') }}</span>
                            </div>
                            <button v-if="canManage" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="editProjects(conn)">{{ $t('AppConnections.link_projects') }}</button>
                            <div v-if="canManage && editing === conn.id" class="apc__picker">
                                <label v-for="p in projects" :key="p.id" class="apc__pick">
                                    <input v-model="picked" type="checkbox" :value="p.id" />
                                    <span>{{ p.name }}</span>
                                </label>
                                <div class="apc__actions">
                                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" @click="saveProjects(conn)">{{ $t('AppConnections.save') }}</button>
                                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="editing = ''">{{ $t('AppConnections.cancel') }}</button>
                                </div>
                            </div>
                        </div>
                    </section>
                </article>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { withoutGithubReturn } from "./githubReturn";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "AppConnections" });

const { t } = useI18n();

const loaded = ref(false);
const enabled = ref(false);
const canManage = ref(false);
const apps = ref([]);
const projects = ref([]);
const error = ref("");
const busy = ref(false);
const connecting = ref("");
const values = ref({});
const editing = ref("");
const picked = ref([]);
const confirming = ref("");
const notice = ref("");
const choosingRepo = ref("");
const repos = ref([]);
const reposPage = ref(1);
const reposMore = ref(false);
const reposLoaded = ref(false);
const pickedRepo = ref("");
const repoFilter = ref("");
const shownRepos = computed(() => {
    const wanted = repoFilter.value.trim().toLowerCase();
    return wanted ? repos.value.filter((r) => r.fullName.toLowerCase().includes(wanted)) : repos.value;
});
const usingToken = ref(false);
const copied = ref("");
const blockedHosts = ref({});
const allowedHosts = ref([]);
const instanceOwner = ref(null);

const EGRESS_BLOCKED = "egress_blocked";
const GITHUB_OUTCOMES = ["expired", "denied", "rights", "off", "failed"];
const GITHUB_REFUSALS = { 400: "github_expired", 403: "github_rights", 409: "github_off" };

const route = useRoute();
const router = useRouter();

const when = (value) => new Date(value).toLocaleString();
const stateOf = (conn) => {
    if (!conn.enabled) return "paused";
    return conn.lastError ? "error" : "connected";
};
const chipOf = (conn) => ({ "ah-chip--ok": stateOf(conn) === "connected", "ah-chip--warn": stateOf(conn) === "paused", "ah-chip--danger": stateOf(conn) === "error" });

const githubFailure = (e) => t(`AppConnections.${GITHUB_REFUSALS[e?.response?.status] || "github_failed"}`);
const failure = (e) => e?.response?.data?.statusText || e?.message || t("AppConnections.failed");

const blockedHostOf = (conn) => {
    const host = blockedHosts.value[conn.id] || (conn.errorCode === EGRESS_BLOCKED ? conn.blockedHost : "");
    return host && !allowedHosts.value.includes(host) ? host : "";
};
const lastErrorOf = (conn) => (conn.errorCode === EGRESS_BLOCKED && conn.blockedHost ? t("AppConnections.egress_blocked", { host: conn.blockedHost }) : conn.lastError);

const checkInstanceOwner = async () => {
    if (instanceOwner.value !== null) return;
    instanceOwner.value = false;
    try {
        const res = await apiRequestWithoutCompnay("get", env.INSTANCE_ACCESS);
        instanceOwner.value = res?.data?.data?.allowed === true;
    } catch (e) {
        instanceOwner.value = false;
    }
};

const markBlocked = (conn, body) => {
    const host = body?.code === EGRESS_BLOCKED ? body?.data?.host || "" : "";
    if (!host) return false;
    blockedHosts.value = { ...blockedHosts.value, [conn.id]: host };
    allowedHosts.value = allowedHosts.value.filter((h) => h !== host);
    checkInstanceOwner();
    return true;
};

const load = async () => {
    try {
        const res = await apiRequest("get", `${env.INTEGRATIONS}/app-connections`);
        const data = res?.data?.status ? res.data.data : null;
        enabled.value = !!data?.enabled;
        canManage.value = !!data?.canManage;
        apps.value = data?.apps || [];
        projects.value = data?.projects || [];
        error.value = data ? "" : res?.data?.statusText || t("AppConnections.failed");
        if (apps.value.some((app) => (app.connections || []).some(blockedHostOf))) checkInstanceOwner();
    } catch (e) {
        error.value = failure(e);
    } finally {
        loaded.value = true;
    }
};

const act = async (run) => {
    busy.value = true;
    error.value = "";
    try {
        const res = await run();
        if (res?.data && res.data.status === false) error.value = res.data.statusText || t("AppConnections.failed");
        else await load();
    } catch (e) {
        error.value = failure(e);
    } finally {
        busy.value = false;
    }
};

const openConnect = async (app) => {
    if (app.oneClick) {
        busy.value = true;
        error.value = "";
        try {
            const res = await apiRequest("get", `${env.INTEGRATIONS}/github/authorize`);
            if (res?.data?.status && res.data.data?.url) window.location.assign(res.data.data.url);
            else error.value = t("AppConnections.github_failed");
        } catch (e) {
            error.value = githubFailure(e);
        } finally {
            busy.value = false;
        }
        return;
    }
    usingToken.value = false;
    values.value = {};
    connecting.value = connecting.value === app.key && app.setup ? "" : app.key;
};

const setupUrls = (app) => [
    { key: "homepage", value: app.setup.homepageUrl },
    { key: "callback", value: app.setup.callbackUrl },
];

const copy = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        copied.value = text;
    } catch (e) {
        copied.value = "";
    }
};

const pickable = (app, conn) => app.key === "github" && (app.oneClick || conn.viaOAuth);

const loadRepos = async (conn, page) => {
    busy.value = true;
    error.value = "";
    try {
        const res = await apiRequest("get", `${env.INTEGRATIONS}/connections/${conn.id}/github-repos?page=${page}`);
        if (markBlocked(conn, res?.data)) { choosingRepo.value = ""; return; }
        if (!res?.data?.status) { error.value = res?.data?.statusText || t("AppConnections.failed"); return; }
        const data = res.data.data || {};
        repos.value = page === 1 ? data.repos || [] : [...repos.value, ...(data.repos || [])];
        reposPage.value = data.page || page;
        reposMore.value = !!data.hasMore;
        reposLoaded.value = true;
    } catch (e) {
        if (markBlocked(conn, e?.response?.data)) choosingRepo.value = "";
        else error.value = failure(e);
    } finally {
        busy.value = false;
    }
};

const openEgress = () => router.push({ name: "InstanceEgress", params: { cid: companyIdOf() } });

const companyIdOf = () => route.params?.cid || localStorage.getItem("selectedCompany") || "";

const allowHost = async (app, conn) => {
    const host = blockedHostOf(conn);
    const cid = companyIdOf();
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
        const read = await apiRequestWithoutCompnay("get", `${env.INSTANCE_EGRESS}?workspace=${cid}`);
        const workspace = read?.data?.status ? (read.data.data?.workspaces || []).find((w) => w.companyId === cid) : null;
        if (!workspace) throw new Error("unread");
        const hosts = workspace.hosts.includes(host) ? workspace.hosts : [...workspace.hosts, host];
        const saved = await apiRequestWithoutCompnay("put", `${env.INSTANCE_EGRESS}/${cid}`, { hosts, version: workspace.version || 0 });
        if (!saved?.data?.status) throw new Error("unsaved");
    } catch (e) {
        error.value = t("AppConnections.egress_allow_failed", { host });
        busy.value = false;
        return;
    }
    busy.value = false;
    allowedHosts.value = [...allowedHosts.value, host];
    blockedHosts.value = Object.fromEntries(Object.entries(blockedHosts.value).filter(([id]) => id !== conn.id));
    notice.value = t("AppConnections.egress_allowed", { host });
    if (canManage.value && pickable(app, conn)) await startPicker(conn);
};

const startPicker = async (conn) => {
    choosingRepo.value = conn.id;
    pickedRepo.value = conn.target || "";
    repoFilter.value = "";
    repos.value = [];
    reposLoaded.value = false;
    await loadRepos(conn, 1);
};

const openRepos = async (conn) => {
    if (choosingRepo.value === conn.id) { choosingRepo.value = ""; return; }
    await startPicker(conn);
};

const saveRepo = async (conn) => {
    await act(async () => {
        try {
            return await apiRequest("put", `${env.INTEGRATIONS}/connections/${conn.id}/repo`, { repo: pickedRepo.value });
        } catch (e) {
            if (markBlocked(conn, e?.response?.data)) return { data: { status: true } };
            throw e;
        }
    });
    if (!error.value) choosingRepo.value = "";
};

const finishGithub = async () => {
    const query = route.query || {};
    const { github: outcome, state, code } = query;
    if (!outcome) return;
    await router.replace({ query: withoutGithubReturn(query) });
    if (outcome !== "complete") {
        if (GITHUB_OUTCOMES.includes(outcome)) error.value = t(`AppConnections.github_${outcome}`);
        return;
    }
    if (typeof state !== "string" || typeof code !== "string") return;
    busy.value = true;
    try {
        const res = await apiRequest("post", `${env.INTEGRATIONS}/github/complete`, { state, code });
        if (res?.data?.status) {
            notice.value = t("AppConnections.github_connected");
            const { id, egressBlocked } = res.data.data || {};
            if (id && egressBlocked) markBlocked({ id }, { code: EGRESS_BLOCKED, data: egressBlocked });
            await load();
        } else error.value = t("AppConnections.github_failed");
    } catch (e) {
        error.value = githubFailure(e);
    } finally {
        busy.value = false;
    }
};

const connect = async (app) => {
    await act(() => apiRequest("post", `${env.INTEGRATIONS}/connections`, { type: app.key, config: { ...values.value } }));
    if (!error.value) { connecting.value = ""; values.value = {}; }
};

const toggle = (conn) => act(() => apiRequest("put", `${env.INTEGRATIONS}/connections/${conn.id}`, { enabled: !conn.enabled }));

const disconnect = async (conn) => {
    if (confirming.value !== conn.id) { confirming.value = conn.id; return; }
    confirming.value = "";
    await act(() => apiRequest("delete", `${env.INTEGRATIONS}/connections/${conn.id}`));
};

const editProjects = (conn) => {
    editing.value = editing.value === conn.id ? "" : conn.id;
    picked.value = conn.projects.map((p) => p.id);
};

const saveProjects = async (conn) => {
    await act(() => apiRequest("put", `${env.INTEGRATIONS}/connections/${conn.id}/projects`, { projectIds: picked.value }));
    if (!error.value) editing.value = "";
};

onMounted(async () => {
    await load();
    await finishGithub();
});
</script>

<style>
@import "./appConnections.css";
</style>
