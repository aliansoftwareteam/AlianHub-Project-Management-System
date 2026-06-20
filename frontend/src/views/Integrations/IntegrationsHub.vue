<template>
    <div class="ig-wrap">
        <div class="ig-topbar">
            <router-link :to="{ name: 'Home', params: { cid: cid } }" class="ig-home" title="Home">
                <img src="@/assets/images/svg/Home.svg" alt="Home" />
            </router-link>
            <h1 class="ig-title">{{ $t('IntegrationsHub.title') }}</h1>
        </div>

        <div class="ig-body">
            <!-- Left rail -->
            <aside class="ig-rail">
                <button v-for="c in cats" :key="c.key" class="ig-cat" :class="{ active: active === c.key }" @click="active = c.key">
                    <span class="ig-cat-ic">{{ c.icon }}</span>
                    <span class="ig-cat-tx">
                        <span class="ig-cat-name">{{ $t('IntegrationsHub.' + c.key) }}</span>
                        <span class="ig-cat-sub">{{ $t('IntegrationsHub.' + c.key + '_sub') }}</span>
                    </span>
                    <span v-if="c.soon" class="ig-soon">{{ $t('IntegrationsHub.soon') }}</span>
                </button>
            </aside>

            <!-- Content -->
            <section class="ig-content">
                <!-- Email to task -->
                <div v-if="active === 'emailToTask'">
                    <div class="ig-head">
                        <h2>{{ $t('IntegrationsHub.emailToTask') }}</h2>
                        <p>{{ $t('IntegrationsHub.email_intro') }}</p>
                    </div>

                    <div class="ig-card ig-create">
                        <label class="ig-lbl">{{ $t('IntegrationsHub.email_pick_project') }}</label>
                        <div class="ig-row">
                            <select v-model="newProjectId" class="form-control">
                                <option value="">{{ $t('IntegrationsHub.email_select') }}</option>
                                <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '(untitled)' }}</option>
                            </select>
                            <button class="ig-btn" :disabled="!newProjectId || busy" @click="createInbox">{{ busy ? $t('IntegrationsHub.creating') : $t('IntegrationsHub.email_create') }}</button>
                        </div>
                        <p class="ig-note">{{ $t('IntegrationsHub.email_note') }}</p>
                    </div>

                    <div v-if="!inboxes.length" class="ig-empty">{{ $t('IntegrationsHub.email_none') }}</div>
                    <div v-for="ib in inboxes" :key="ib._id" class="ig-card ig-inbox" :class="{ off: !ib.enabled }">
                        <div class="ig-inbox-top">
                            <span class="ig-inbox-name">{{ ib.name }}</span>
                            <span class="ig-pill" :class="ib.enabled ? 'on' : 'paused'">{{ ib.enabled ? $t('IntegrationsHub.active') : $t('IntegrationsHub.paused') }}</span>
                            <span class="ig-inbox-count">{{ ib.receivedCount || 0 }} {{ $t('IntegrationsHub.received') }}</span>
                        </div>
                        <label class="ig-lbl">{{ $t('IntegrationsHub.email_address') }}</label>
                        <div class="ig-row">
                            <input class="form-control ig-mono" :value="ib.address" readonly @focus="$event.target.select()" />
                            <button class="ig-mini" @click="copy(ib.address)">{{ $t('IntegrationsHub.copy') }}</button>
                        </div>
                        <label class="ig-lbl">{{ $t('IntegrationsHub.email_webhook') }}</label>
                        <div class="ig-row">
                            <input class="form-control ig-mono" :value="webhookUrl(ib.token)" readonly @focus="$event.target.select()" />
                            <button class="ig-mini" @click="copy(webhookUrl(ib.token))">{{ $t('IntegrationsHub.copy') }}</button>
                        </div>
                        <div class="ig-inbox-actions">
                            <button class="ig-mini" @click="toggle(ib)">{{ ib.enabled ? $t('IntegrationsHub.pause') : $t('IntegrationsHub.resume') }}</button>
                            <button class="ig-mini del" @click="remove(ib)">{{ $t('IntegrationsHub.delete') }}</button>
                        </div>
                    </div>

                    <details class="ig-help">
                        <summary>{{ $t('IntegrationsHub.email_help_title') }}</summary>
                        <ol>
                            <li>{{ $t('IntegrationsHub.email_help_1') }}</li>
                            <li>{{ $t('IntegrationsHub.email_help_2') }}</li>
                            <li>{{ $t('IntegrationsHub.email_help_3') }}</li>
                        </ol>
                    </details>
                </div>

                <!-- Custom apps / iframe plugins (AUTO-07) -->
                <div v-else-if="active === 'apps'">
                    <div class="ig-head">
                        <h2>{{ $t('IntegrationsHub.apps') }}</h2>
                        <p>{{ $t('IntegrationsHub.apps_intro') }}</p>
                    </div>
                    <div class="ig-card">
                        <div class="ig-row">
                            <input v-model="appForm.name" class="form-control" :placeholder="$t('IntegrationsHub.apps_name')" />
                            <input v-model="appForm.url" class="form-control" :placeholder="$t('IntegrationsHub.apps_url')" />
                            <button class="ig-btn" :disabled="busy || !appForm.name.trim() || !appForm.url.trim()" @click="addApp">{{ $t('IntegrationsHub.apps_add') }}</button>
                        </div>
                        <p class="ig-note">{{ $t('IntegrationsHub.apps_note') }}</p>
                    </div>
                    <div v-if="!apps.length" class="ig-empty">{{ $t('IntegrationsHub.apps_none') }}</div>
                    <div v-if="apps.length" class="ig-apps-tabs">
                        <button v-for="a in apps" :key="a._id" class="ig-app-tab" :class="{ active: activeApp && activeApp._id === a._id }" @click="openApp(a)">
                            {{ a.name }}<span class="ig-app-x" @click.stop="removeApp(a)">✕</span>
                        </button>
                    </div>
                    <div v-if="activeApp" class="ig-app-frame">
                        <iframe :src="activeApp.config && activeApp.config.url" sandbox="allow-scripts allow-forms allow-popups allow-same-origin" referrerpolicy="no-referrer" loading="lazy"></iframe>
                    </div>
                </div>

                <!-- Marketplace (AUTO-05) -->
                <div v-else-if="active === 'marketplace'">
                    <div class="ig-head">
                        <h2>{{ $t('IntegrationsHub.marketplace') }}</h2>
                        <p>{{ $t('IntegrationsHub.mp_intro') }}</p>
                    </div>
                    <input v-model="mpSearch" class="form-control ig-mp-search" :placeholder="$t('IntegrationsHub.mp_search')" />
                    <div class="ig-mp-grid">
                        <div v-for="item in filteredCatalog" :key="item.key" class="ig-mp-card">
                            <div class="ig-mp-top">
                                <span class="ig-mp-ic">{{ item.icon }}</span>
                                <span class="ig-mp-name">{{ item.name }}</span>
                                <span v-if="connectedFor(item.key)" class="ig-pill on">{{ $t('IntegrationsHub.connected') }}</span>
                                <span v-else class="ig-mp-cat">{{ item.category }}</span>
                            </div>
                            <p class="ig-mp-desc">{{ item.description }}</p>
                            <div v-if="mpForm.type === item.key" class="ig-mp-form">
                                <div v-for="f in item.fields" :key="f.key" class="ig-mp-field">
                                    <label class="ig-lbl">{{ f.label }}</label>
                                    <input v-model="mpForm.config[f.key]" :type="f.secret ? 'password' : 'text'" class="form-control" autocomplete="off" />
                                </div>
                                <div class="ig-row ig-mt10">
                                    <button class="ig-btn" :disabled="busy" @click="submitConnect(item)">{{ $t('IntegrationsHub.mp_save') }}</button>
                                    <button class="ig-mini" @click="mpForm.type = ''">{{ $t('IntegrationsHub.mp_cancel') }}</button>
                                </div>
                            </div>
                            <div v-else class="ig-mp-actions">
                                <button class="ig-mini" @click="openConnect(item)">{{ connectedFor(item.key) ? $t('IntegrationsHub.mp_reconfigure') : $t('IntegrationsHub.mp_connect') }}</button>
                                <button v-if="connectedFor(item.key)" class="ig-mini del" @click="disconnect(connectedFor(item.key))">{{ $t('IntegrationsHub.mp_disconnect') }}</button>
                            </div>
                            <div v-if="item.key === 'slack' && connectedFor(item.key)" class="ig-mp-slack">
                                <label class="ig-lbl">{{ $t('IntegrationsHub.slack_url') }}</label>
                                <div class="ig-row">
                                    <input class="form-control ig-mono" :value="slackUrl" readonly @focus="$event.target.select()" />
                                    <button class="ig-mini" @click="copy(slackUrl)">{{ $t('IntegrationsHub.copy') }}</button>
                                </div>
                                <p class="ig-note">{{ $t('IntegrationsHub.slack_hint') }}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Automations (AUTO-03) -->
                <div v-else-if="active === 'automations'">
                    <div class="ig-head">
                        <h2>{{ $t('IntegrationsHub.automations') }}</h2>
                        <p>{{ $t('IntegrationsHub.auto_intro') }}</p>
                    </div>
                    <div class="ig-card">
                        <label class="ig-lbl">{{ $t('IntegrationsHub.auto_name') }}</label>
                        <input v-model="ruleForm.name" class="form-control" :placeholder="$t('IntegrationsHub.auto_name_ph')" />
                        <div class="ig-auto-grid">
                            <div>
                                <label class="ig-lbl">{{ $t('IntegrationsHub.auto_when') }}</label>
                                <select v-model="ruleForm.projectId" class="form-control">
                                    <option value="">{{ $t('IntegrationsHub.auto_any_project') }}</option>
                                    <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '(untitled)' }}</option>
                                </select>
                                <select v-model="ruleForm.condPriority" class="form-control ig-mt6">
                                    <option value="">{{ $t('IntegrationsHub.auto_any_priority') }}</option>
                                    <option value="LOW">LOW</option><option value="MEDIUM">MEDIUM</option><option value="HIGH">HIGH</option>
                                </select>
                            </div>
                            <div>
                                <label class="ig-lbl">{{ $t('IntegrationsHub.auto_then') }}</label>
                                <select v-model="ruleForm.actionPriority" class="form-control">
                                    <option value="LOW">LOW</option><option value="MEDIUM">MEDIUM</option><option value="HIGH">HIGH</option>
                                </select>
                            </div>
                        </div>
                        <div class="ig-row ig-mt10">
                            <button class="ig-btn" :disabled="!ruleForm.name.trim() || busy" @click="createRule">{{ busy ? $t('IntegrationsHub.creating') : $t('IntegrationsHub.auto_create') }}</button>
                        </div>
                    </div>
                    <div v-if="!rules.length" class="ig-empty">{{ $t('IntegrationsHub.auto_none') }}</div>
                    <div v-for="r in rules" :key="r._id" class="ig-card ig-inbox">
                        <div class="ig-inbox-top">
                            <span class="ig-inbox-name">{{ r.name }}</span>
                            <span class="ig-inbox-count">{{ r.lastRunCount || 0 }} {{ $t('IntegrationsHub.auto_affected') }}</span>
                        </div>
                        <p class="ig-note">{{ r.summary }}</p>
                        <div class="ig-inbox-actions">
                            <button class="ig-mini" @click="applyRule(r)">{{ $t('IntegrationsHub.auto_apply') }}</button>
                            <button class="ig-mini del" @click="removeRule(r)">{{ $t('IntegrationsHub.delete') }}</button>
                        </div>
                    </div>
                </div>

                <!-- Calendar (AUTO-02) -->
                <div v-else-if="active === 'calendar'">
                    <div class="ig-head">
                        <h2>{{ $t('IntegrationsHub.calendar') }}</h2>
                        <p>{{ $t('IntegrationsHub.cal_intro') }}</p>
                    </div>
                    <div class="ig-card ig-create">
                        <label class="ig-lbl">{{ $t('IntegrationsHub.cal_scope') }}</label>
                        <div class="ig-row">
                            <select v-model="calScope" class="form-control">
                                <option value="my">{{ $t('IntegrationsHub.cal_my') }}</option>
                                <option value="project">{{ $t('IntegrationsHub.cal_project') }}</option>
                            </select>
                            <select v-if="calScope === 'project'" v-model="calProjectId" class="form-control">
                                <option value="">{{ $t('IntegrationsHub.email_select') }}</option>
                                <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '(untitled)' }}</option>
                            </select>
                            <button class="ig-btn" :disabled="busy || (calScope === 'project' && !calProjectId)" @click="createFeed">{{ busy ? $t('IntegrationsHub.creating') : $t('IntegrationsHub.cal_create') }}</button>
                        </div>
                    </div>
                    <div v-if="!feeds.length" class="ig-empty">{{ $t('IntegrationsHub.cal_none') }}</div>
                    <div v-for="f in feeds" :key="f._id" class="ig-card ig-inbox">
                        <div class="ig-inbox-top">
                            <span class="ig-inbox-name">{{ f.name }}</span>
                            <span class="ig-pill on">{{ f.scope === 'my' ? $t('IntegrationsHub.cal_my') : $t('IntegrationsHub.cal_project') }}</span>
                        </div>
                        <label class="ig-lbl">{{ $t('IntegrationsHub.cal_url') }}</label>
                        <div class="ig-row">
                            <input class="form-control ig-mono" :value="f.url" readonly @focus="$event.target.select()" />
                            <button class="ig-mini" @click="copy(f.url)">{{ $t('IntegrationsHub.copy') }}</button>
                        </div>
                        <div class="ig-inbox-actions">
                            <button class="ig-mini del" @click="removeFeed(f)">{{ $t('IntegrationsHub.delete') }}</button>
                        </div>
                    </div>
                    <details class="ig-help">
                        <summary>{{ $t('IntegrationsHub.cal_help_title') }}</summary>
                        <ol>
                            <li>{{ $t('IntegrationsHub.cal_help_1') }}</li>
                            <li>{{ $t('IntegrationsHub.cal_help_2') }}</li>
                        </ol>
                    </details>
                </div>

                <!-- Placeholder sections (filled as AUTO-03..07 land) -->
                <div v-else class="ig-soon-panel">
                    <div class="ig-soon-ic">{{ activeCat.icon }}</div>
                    <h2>{{ $t('IntegrationsHub.' + active) }}</h2>
                    <p>{{ $t('IntegrationsHub.' + active + '_sub') }}</p>
                    <span class="ig-pill paused">{{ $t('IntegrationsHub.soon') }}</span>
                </div>
            </section>
        </div>
    </div>
</template>

<script>
export default { name: 'IntegrationsHub' };
</script>

<script setup>
import { ref, reactive, computed, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import { useGetterFunctions } from '@/composable';
import * as env from '@/config/env';

// AUTO module — unified Integrations & Automation hub. Email-to-task (AUTO-01) is
// live; the other categories are scaffolded and fill in as their backends land.
const companyIdRef = inject('$companyId');
const userId = inject('$userId');
const { getUser } = useGetterFunctions();
const cid = computed(() => (companyIdRef && companyIdRef.value) || companyIdRef || '');

const cats = [
    { key: 'emailToTask', icon: '✉️', soon: false },
    { key: 'automations', icon: '⚡', soon: false },
    { key: 'calendar', icon: '📅', soon: false },
    { key: 'marketplace', icon: '🧩', soon: false },
    { key: 'slack', icon: '💬', soon: true },
    { key: 'apps', icon: '🪟', soon: false },
];
const active = ref('emailToTask');
const activeCat = computed(() => cats.find((c) => c.key === active.value) || cats[0]);

const projects = ref([]);
const inboxes = ref([]);
const newProjectId = ref('');
const feeds = ref([]);
const calScope = ref('my');
const calProjectId = ref('');
const rules = ref([]);
const ruleForm = reactive({ name: '', projectId: '', condPriority: '', actionPriority: 'HIGH' });
const catalog = ref([]);
const connections = ref([]);
const mpSearch = ref('');
const mpForm = reactive({ type: '', config: {} });
const appForm = reactive({ name: '', url: '' });
const activeApp = ref(null);
const busy = ref(false);

const apps = computed(() => connections.value.filter((c) => c.type === 'custom_iframe'));

const filteredCatalog = computed(() => {
    const q = mpSearch.value.trim().toLowerCase();
    return catalog.value
        .filter((i) => !i.multiple)
        .filter((i) => !q || (i.name || '').toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q));
});
const connectedFor = (type) => connections.value.find((c) => c.type === type) || null;
const slackUrl = computed(() => `${window.location.origin}/api/v1/slack/command/${cid.value}`);

const webhookUrl = (token) => `${window.location.origin}${env.EMAIL_IN}/${token}`;

const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        projects.value = Array.isArray(body) ? body : (body && body.data) || [];
    } catch (e) { projects.value = []; }
};
const loadInboxes = async () => {
    try {
        const body = (await apiRequest('get', `${env.EMAIL_IN}/inboxes`))?.data;
        inboxes.value = (body && body.data) || [];
    } catch (e) { inboxes.value = []; }
};
const createInbox = async () => {
    if (!newProjectId.value || busy.value) return;
    busy.value = true;
    try {
        const u = (getUser && getUser(userId && userId.value)) || {};
        await apiRequest('post', `${env.EMAIL_IN}/inboxes`, {
            projectId: newProjectId.value,
            userData: { id: u.id || (userId && userId.value), Employee_Name: u.Employee_Name || '', companyOwnerId: u.companyOwnerId || '' },
        });
        newProjectId.value = '';
        await loadInboxes();
    } catch (e) { /* surfaced via reload */ } finally { busy.value = false; }
};
const toggle = async (ib) => {
    try { await apiRequest('put', `${env.EMAIL_IN}/inboxes/${ib._id}`, { enabled: !ib.enabled }); await loadInboxes(); } catch (e) { /* noop */ }
};
const remove = async (ib) => {
    try { await apiRequest('delete', `${env.EMAIL_IN}/inboxes/${ib._id}`); await loadInboxes(); } catch (e) { /* noop */ }
};
const copy = (text) => { if (text) navigator.clipboard.writeText(text); };

// AUTO-02 — calendar feeds.
const loadFeeds = async () => {
    try { const body = (await apiRequest('get', `${env.CALENDAR_FEED}/feeds`))?.data; feeds.value = (body && body.data) || []; } catch (e) { feeds.value = []; }
};
const createFeed = async () => {
    if (busy.value || (calScope.value === 'project' && !calProjectId.value)) return;
    busy.value = true;
    try {
        const u = (getUser && getUser(userId && userId.value)) || {};
        await apiRequest('post', `${env.CALENDAR_FEED}/feeds`, {
            scope: calScope.value, projectId: calProjectId.value,
            userData: { id: u.id || (userId && userId.value), Employee_Name: u.Employee_Name || '' },
        });
        calProjectId.value = '';
        await loadFeeds();
    } catch (e) { /* noop */ } finally { busy.value = false; }
};
const removeFeed = async (f) => {
    try { await apiRequest('delete', `${env.CALENDAR_FEED}/feeds/${f._id}`); await loadFeeds(); } catch (e) { /* noop */ }
};

// AUTO-03 — automation rules.
const loadRules = async () => {
    try { const b = (await apiRequest('get', env.AUTOMATIONS))?.data; rules.value = (b && b.data) || []; } catch (e) { rules.value = []; }
};
const createRule = async () => {
    if (!ruleForm.name.trim() || busy.value) return;
    busy.value = true;
    try {
        const conditions = {};
        if (ruleForm.projectId) conditions.projectId = ruleForm.projectId;
        if (ruleForm.condPriority) conditions.priority = ruleForm.condPriority;
        await apiRequest('post', env.AUTOMATIONS, { name: ruleForm.name.trim(), conditions, actions: [{ type: 'set_priority', value: ruleForm.actionPriority }] });
        ruleForm.name = ''; ruleForm.projectId = ''; ruleForm.condPriority = '';
        await loadRules();
    } catch (e) { /* noop */ } finally { busy.value = false; }
};
const applyRule = async (r) => {
    try { await apiRequest('post', `${env.AUTOMATIONS}/${r._id}/apply`, {}); await loadRules(); } catch (e) { /* noop */ }
};
const removeRule = async (r) => {
    try { await apiRequest('delete', `${env.AUTOMATIONS}/${r._id}`); await loadRules(); } catch (e) { /* noop */ }
};

// AUTO-05 — integrations marketplace (consumes the AUTO-04 catalog + connections).
const loadCatalog = async () => {
    try { const b = (await apiRequest('get', `${env.INTEGRATIONS}/catalog`))?.data; catalog.value = (b && b.data) || []; } catch (e) { catalog.value = []; }
};
const loadConnections = async () => {
    try { const b = (await apiRequest('get', `${env.INTEGRATIONS}/connections`))?.data; connections.value = (b && b.data) || []; } catch (e) { connections.value = []; }
};
const openConnect = (item) => {
    mpForm.type = item.key; mpForm.config = {};
    const existing = connectedFor(item.key);
    if (existing && existing.config) (item.fields || []).forEach((f) => { if (!f.secret && existing.config[f.key] != null) mpForm.config[f.key] = existing.config[f.key]; });
};
const submitConnect = async (item) => {
    busy.value = true;
    try {
        await apiRequest('post', `${env.INTEGRATIONS}/connections`, { type: item.key, config: { ...mpForm.config } });
        mpForm.type = ''; mpForm.config = {};
        await loadConnections();
    } catch (e) { /* noop */ } finally { busy.value = false; }
};
const disconnect = async (conn) => {
    if (!conn) return;
    try { await apiRequest('delete', `${env.INTEGRATIONS}/connections/${conn._id}`); await loadConnections(); } catch (e) { /* noop */ }
};

// AUTO-07 — custom iframe apps (stored as custom_iframe connections).
const addApp = async () => {
    if (busy.value || !appForm.name.trim() || !appForm.url.trim()) return;
    busy.value = true;
    try {
        await apiRequest('post', `${env.INTEGRATIONS}/connections`, { type: 'custom_iframe', config: { name: appForm.name.trim(), url: appForm.url.trim() } });
        appForm.name = ''; appForm.url = '';
        await loadConnections();
    } catch (e) { /* noop */ } finally { busy.value = false; }
};
const openApp = (a) => { activeApp.value = a; };
const removeApp = async (a) => {
    try {
        await apiRequest('delete', `${env.INTEGRATIONS}/connections/${a._id}`);
        if (activeApp.value && activeApp.value._id === a._id) activeApp.value = null;
        await loadConnections();
    } catch (e) { /* noop */ }
};

onMounted(() => { loadProjects(); loadInboxes(); loadFeeds(); loadRules(); loadCatalog(); loadConnections(); });
</script>

<style scoped>
.ig-wrap { display: flex; flex-direction: column; height: calc(100dvh - 46px); background: #f7f8fc; }
.ig-topbar { display: flex; align-items: center; gap: 14px; padding: 12px 22px; border-bottom: 1px solid #e6e7ee; background: #fff; }
.ig-home img { width: 20px; height: 20px; }
.ig-title { font-size: 18px; margin: 0; color: #2b2f44; }
.ig-body { flex: 1; display: grid; grid-template-columns: 264px 1fr; min-height: 0; }
@media (max-width: 820px) { .ig-body { grid-template-columns: 1fr; } }
.ig-rail { border-right: 1px solid #e6e7ee; background: #fff; padding: 12px; overflow-y: auto; }
.ig-cat { width: 100%; display: flex; align-items: center; gap: 11px; padding: 11px 12px; border: 1px solid transparent; border-radius: 10px; background: none; cursor: pointer; text-align: left; margin-bottom: 4px; }
.ig-cat:hover { background: #f2f3fb; }
.ig-cat.active { background: #eef0ff; border-color: #d7dbff; }
.ig-cat-ic { font-size: 18px; width: 24px; text-align: center; }
.ig-cat-tx { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.ig-cat-name { font-size: 13.5px; font-weight: 600; color: #33384a; }
.ig-cat-sub { font-size: 11px; color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ig-soon { font-size: 9.5px; font-weight: 700; color: #9a6b00; background: #fff3d6; border-radius: 6px; padding: 2px 6px; }
.ig-content { padding: 22px 26px; overflow-y: auto; }
.ig-head h2 { font-size: 19px; margin: 0 0 4px; color: #2b2f44; }
.ig-head p { color: #6b7280; font-size: 13px; margin: 0 0 18px; max-width: 640px; }
.ig-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; max-width: 720px; }
.ig-create .ig-row { gap: 10px; }
.ig-row { display: flex; align-items: center; gap: 8px; }
.ig-row .form-control { flex: 1; min-width: 0; }
.ig-lbl { display: block; font-size: 11.5px; font-weight: 600; color: #6b7280; margin: 10px 0 5px; }
.ig-create .ig-lbl { margin-top: 0; }
.ig-mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; background: #fafbff; }
.ig-note { font-size: 12px; color: #9aa0b4; margin: 10px 0 0; }
.ig-empty { color: #9aa0b4; font-size: 13px; padding: 8px 2px 16px; }
.ig-inbox.off { opacity: .7; }
.ig-inbox-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.ig-inbox-name { font-size: 14px; font-weight: 700; color: #33384a; }
.ig-inbox-count { font-size: 11.5px; color: #9aa0b4; margin-left: auto; }
.ig-inbox-actions { display: flex; gap: 8px; margin-top: 12px; }
.ig-pill { font-size: 10px; font-weight: 700; border-radius: 6px; padding: 2px 8px; }
.ig-pill.on { background: #e7f6ee; color: #1c7a43; }
.ig-pill.paused { background: #fff3d6; color: #9a6b00; }
.ig-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.ig-btn:disabled { opacity: .55; cursor: default; }
.ig-mini { border: 1px solid #e0e2ee; background: #fff; border-radius: 7px; padding: 6px 11px; font-size: 12px; cursor: pointer; color: #33384a; }
.ig-mini:hover { background: #f2f3fb; }
.ig-mini.del { color: #c0392b; border-color: #f3d6d6; }
.ig-help { max-width: 720px; margin-top: 6px; font-size: 12.5px; color: #6b7280; }
.ig-help summary { cursor: pointer; font-weight: 600; color: #2f3a8f; }
.ig-help ol { margin: 10px 0 0; padding-left: 20px; line-height: 1.7; }
.ig-soon-panel { text-align: center; color: #6b7280; padding: 60px 20px; max-width: 460px; margin: 0 auto; }
.ig-soon-ic { font-size: 44px; margin-bottom: 10px; }
.ig-soon-panel h2 { font-size: 20px; color: #2b2f44; margin: 0 0 6px; }
.ig-soon-panel p { font-size: 13px; margin: 0 0 14px; }
.ig-auto-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
@media (max-width: 600px) { .ig-auto-grid { grid-template-columns: 1fr; } }
.ig-mt6 { margin-top: 6px; }
.ig-mt10 { margin-top: 12px; }
.ig-mp-search { max-width: 360px; margin-bottom: 16px; }
.ig-mp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.ig-mp-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 12px; padding: 15px 16px; }
.ig-mp-top { display: flex; align-items: center; gap: 9px; }
.ig-mp-ic { font-size: 20px; }
.ig-mp-name { font-size: 14.5px; font-weight: 700; color: #2b2f44; }
.ig-mp-cat { margin-left: auto; font-size: 10.5px; color: #9aa0b4; background: #f2f3fb; border-radius: 6px; padding: 2px 8px; }
.ig-mp-top .ig-pill { margin-left: auto; }
.ig-mp-desc { font-size: 12.5px; color: #6b7280; margin: 9px 0 12px; min-height: 34px; }
.ig-mp-form { border-top: 1px solid #f0f1f6; padding-top: 10px; }
.ig-mp-field { margin-bottom: 8px; }
.ig-mp-actions { display: flex; gap: 8px; }
.ig-mp-slack { border-top: 1px solid #f0f1f6; margin-top: 10px; padding-top: 10px; }
.ig-apps-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.ig-app-tab { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #e0e2ee; background: #fff; border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; color: #33384a; }
.ig-app-tab.active { background: #eef0ff; border-color: #d7dbff; }
.ig-app-x { color: #9aa0b4; font-size: 11px; }
.ig-app-x:hover { color: #c0392b; }
.ig-app-frame { border: 1px solid #e6e7ee; border-radius: 10px; overflow: hidden; background: #fff; height: calc(100dvh - 230px); min-height: 360px; }
.ig-app-frame iframe { width: 100%; height: 100%; border: 0; }
</style>
