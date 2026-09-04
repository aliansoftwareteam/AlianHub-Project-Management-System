<template>
    <div class="pal" @keydown="onKey">
        <div class="pal__field">
            <ShellIcon name="search" :size="15" class="pal__glass" />
            <input
                ref="inputEl"
                v-model="query"
                type="text"
                class="pal__input"
                :placeholder="$t('Inbox.search_placeholder')"
                autocomplete="off"
                spellcheck="false"
                @input="onInput"
            />
            <span v-if="searching" class="pal__spin" aria-hidden="true"></span>
            <button type="button" class="ah-kbd pal__esc" @click="close">ESC</button>
        </div>

        <div ref="bodyEl" class="pal__body ah-scroll">
            <template v-if="flat.length">
                <template v-for="g in groups" :key="g.key">
                    <div v-if="g.rows.length" class="pal__group">{{ $t('Inbox.group_' + g.key) }}</div>
                    <button
                        v-for="row in g.rows"
                        :key="row.id"
                        type="button"
                        class="pal__row"
                        :class="{ 'is-active': row.index === active, 'is-ask': row.kind === 'ask' }"
                        :data-index="row.index"
                        @mouseenter="active = row.index"
                        @click="run(row)"
                    >
                        <span v-if="row.avatar" class="ah-avatar ah-avatar--sm pal__avatar">
                            <img v-if="row.avatar.image" :src="row.avatar.image" alt="" />
                            <template v-else>{{ row.avatar.initial }}</template>
                        </span>
                        <span v-else-if="row.swatch" class="pal__swatch" :style="{ background: row.swatch }"></span>
                        <span v-else class="pal__icon" :class="row.iconClass"><ShellIcon :name="row.icon || 'dot'" :size="12" /></span>
                        <span class="pal__text">
                            <span class="pal__title" :class="{ 'is-bold': row.bold }">{{ row.title }}</span>
                            <span v-if="row.sub" class="pal__sub">{{ row.sub }}</span>
                        </span>
                        <span v-if="row.hint" class="pal__hint">{{ row.hint }}</span>
                    </button>
                </template>
            </template>

            <div v-else-if="query.trim().length >= 2 && !searching" class="pal__empty">
                <span class="pal__icon pal__icon--brand"><ShellIcon name="search" :size="13" /></span>
                <div class="pal__empty-title">{{ $t('Inbox.search_nothing', { q: query.trim() }) }}</div>
                <div class="pal__empty-sub">{{ $t('Inbox.search_nothing_sub', { n: sourceCount }) }}</div>
                <div class="pal__empty-actions">
                    <button v-if="hasAi" type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="askAi">✦ {{ $t('Inbox.ask_ai') }}</button>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="clearQuery">{{ $t('Inbox.clear_search') }}</button>
                </div>
            </div>

            <div v-else class="pal__empty pal__empty--idle">
                <div class="pal__empty-sub">{{ $t('Inbox.search_idle') }}</div>
            </div>
        </div>

        <div class="pal__foot">
            <span>↑↓ {{ $t('Inbox.hint_move') }}</span>
            <span>↵ {{ $t('Inbox.hint_open') }}</span>
            <span>⌘↵ {{ $t('Inbox.hint_command') }}</span>
            <span class="pal__foot-right">{{ $t('Inbox.searching_sources', { n: sourceCount }) }}</span>
        </div>
    </div>
</template>

<script setup>
import { computed, defineEmits, inject, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useStore } from 'vuex';
import { apiRequest, useAuth } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable } from '@/composable';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { toggleTheme, shellState } from '@/components/organisms/Shell/shellState';
import '@/components/molecules/AdvanceSearch/style.css';

defineOptions({ name: 'CommandPalette' });

const emit = defineEmits(['closeModel']);
const router = useRouter();
const { t } = useI18n();
const { getters } = useStore();
const { debounce, checkPermission } = useCustomComposable();
const { logOut } = useAuth();
const companyId = inject('$companyId');

const RECENT_KEY = 'alianhub.search.recent';
const MAX_RECENT = 6;
const MAX_PER_GROUP = 5;

const inputEl = ref(null);
const bodyEl = ref(null);
const query = ref('');
const active = ref(0);
const searching = ref(false);
const records = ref({ tasks: [], projects: [], pages: [], comments: [] });
const connections = ref([]);
const recent = ref([]);

const cid = computed(() => companyId?.value || '');
const hasAi = computed(() => router.hasRoute('AiHub'));
const users = computed(() => getters['users/users'] || []);
const norm = (s) => String(s || '').toLowerCase();
const q = computed(() => norm(query.value.trim()));
const matches = (...fields) => !q.value || fields.some((f) => norm(f).includes(q.value));

const to = (name, extra = {}) => ({ name, params: { cid: cid.value, ...(extra.params || {}) }, query: extra.query });
const allowed = (key) => { const r = checkPermission(key); return r !== null && r !== undefined; };
const timesheetRoute = () => ['User Timesheet', 'project Timesheet', 'Workload Timesheet', 'Tracker Timesheet'].find((n) => router.hasRoute(n)) || null;

const NAV = computed(() => [
    { key: 'home', label: t('Shell.home'), icon: 'home', route: 'Home' },
    { key: 'planner', label: t('Shell.planner'), icon: 'planner', route: 'Planner' },
    { key: 'chat', label: t('Shell.chat'), icon: 'chat', route: 'chats', show: allowed('chat') },
    { key: 'inbox', label: t('Inbox.title'), icon: 'inbox', route: 'inbox' },
    { key: 'projects', label: t('Header.Projects'), icon: 'projects', route: 'Projects', show: allowed('project.project_list') },
    { key: 'pages', label: t('Shell.docs'), icon: 'docs', route: 'Pages' },
    { key: 'dash', label: t('Shell.dash'), icon: 'dash', route: 'Dashboards' },
    { key: 'time', label: t('Shell.time'), icon: 'time', route: timesheetRoute() },
    { key: 'settings', label: t('settingslider.Settings'), icon: 'settings', route: 'Setting' },
    { key: 'members', label: t('settingslider.Members'), icon: 'members', route: 'Members', sub: t('settingslider.Settings') },
    { key: 'teams', label: t('Inbox.nav_teams'), icon: 'members', route: 'Teams', sub: t('settingslider.Settings') },
    { key: 'integrations', label: t('Header.Integrations'), icon: 'integrations', route: 'Integrations', sub: t('settingslider.Settings') },
    { key: 'notifications', label: t('Inbox.nav_notifications'), icon: 'bell', route: 'Notifications', sub: t('settingslider.Settings') },
    { key: 'tracking', label: t('Inbox.nav_time_tracking'), icon: 'time', route: 'Time Tracking', sub: t('settingslider.Settings') },
    { key: 'profile', label: t('Shell.my_profile'), icon: 'user', route: 'My Profile', sub: t('settingslider.Settings') },
    { key: 'security', label: t('Inbox.nav_security'), icon: 'shield', route: 'Security & Permissions', sub: t('settingslider.Settings') },
    { key: 'audit', label: t('Audit.title'), icon: 'audit', route: 'AuditLog' },
    { key: 'changelog', label: t('Changelog.whats_new'), icon: 'changelog', route: 'Changelog' },
].filter((n) => n.route && router.hasRoute(n.route) && n.show !== false));

const COMMANDS = computed(() => [
    { key: 'new-task', label: t('Inbox.cmd_new_task'), icon: 'plus', hint: '⌘⏎', show: allowed('project.project_list') },
    { key: 'new-project', label: t('Inbox.cmd_new_project'), icon: 'projects', show: allowed('project.project_list') },
    { key: 'start-timer', label: t('Inbox.cmd_start_timer'), icon: 'play', show: !!timesheetRoute() },
    { key: 'toggle-theme', label: shellState.theme === 'dark' ? t('Shell.theme_light') : t('Shell.theme_dark'), icon: shellState.theme === 'dark' ? 'sun' : 'moon' },
    { key: 'logout', label: t('Shell.logout'), icon: 'logout' },
].filter((c) => c.show !== false));

const initialOf = (name) => String(name || '?').trim().charAt(0).toUpperCase();

const groups = computed(() => {
    let index = 0;
    const row = (r) => ({ ...r, index: index++ });
    const out = [];

    if (!q.value && recent.value.length) {
        out.push({ key: 'recent', rows: recent.value.map((r) => row({ id: `recent:${r}`, kind: 'recent', icon: 'search', title: r, value: r })) });
    }

    const nav = NAV.value.filter((n) => matches(n.label, n.key, n.sub)).slice(0, q.value ? MAX_PER_GROUP : 8);
    out.push({ key: 'navigation', rows: nav.map((n) => row({ id: `nav:${n.key}`, kind: 'nav', icon: n.icon, title: n.label, sub: n.sub, route: n.route })) });

    if (q.value.length >= 2) {
        const rec = [];
        records.value.tasks.slice(0, MAX_PER_GROUP).forEach((task) => rec.push(row({
            id: `task:${task._id}`, kind: 'task', swatch: task.status?.color || 'var(--brand)', bold: true,
            title: task.TaskName, sub: [projectName(task.ProjectID), task.status?.text].filter(Boolean).join(' · '), hint: task.TaskKey || '', task,
        })));
        records.value.projects.slice(0, MAX_PER_GROUP).forEach((p) => rec.push(row({
            id: `project:${p._id}`, kind: 'project', icon: 'projects', title: p.ProjectName, sub: t('Header.Projects'), project: p,
        })));
        records.value.pages.slice(0, MAX_PER_GROUP).forEach((p) => rec.push(row({
            id: `page:${p._id}`, kind: 'page', icon: 'docs', title: p.title, sub: pageSub(p), page: p,
        })));
        out.push({ key: 'records', rows: rec });

        const people = users.value.filter((u) => matches(u.Employee_Name, u.Employee_Email)).slice(0, MAX_PER_GROUP);
        out.push({ key: 'people', rows: people.map((u) => row({
            id: `user:${u._id}`, kind: 'person', avatar: { image: u.Employee_profileImageURL || '', initial: initialOf(u.Employee_Name) },
            title: u.Employee_Name, sub: u.Employee_Email, user: u,
        })) });

        const apps = connections.value.filter((c) => matches(c.name, c.type)).slice(0, MAX_PER_GROUP);
        out.push({ key: 'apps', rows: apps.map((c) => row({
            id: `app:${c._id}`, kind: 'app', icon: /github|gitlab/i.test(c.type) ? 'github' : 'integrations', iconClass: 'pal__icon--dark',
            title: c.name, sub: t('Inbox.app_connected'), app: c,
        })) });

        if (hasAi.value) {
            out.push({ key: 'ask', rows: [row({ id: 'ask', kind: 'ask', icon: 'ai', iconClass: 'pal__icon--brand', bold: true, title: t('Inbox.ask_query', { q: query.value.trim() }), hint: '↵' })] });
        }
    }

    const cmds = COMMANDS.value.filter((c) => matches(c.label, c.key)).slice(0, q.value ? 3 : COMMANDS.value.length);
    out.push({ key: 'commands', rows: cmds.map((c) => row({ id: `cmd:${c.key}`, kind: 'command', icon: c.icon, title: c.label, hint: c.hint, command: c.key })) });

    return out.filter((g) => g.rows.length);
});
const flat = computed(() => groups.value.flatMap((g) => g.rows));
const sourceCount = computed(() => 2 + (connections.value.length ? 1 : 0) + (hasAi.value ? 1 : 0));

const projectName = (id) => (getters['projectData/projects']?.data || []).find((p) => String(p._id) === String(id))?.ProjectName || '';
const pageSub = (p) => {
    const who = users.value.find((u) => String(u._id) === String(p.updatedBy))?.Employee_Name;
    return [t('Shell.docs'), who ? t('Inbox.edited_by', { who }) : ''].filter(Boolean).join(' · ');
};

const loadRecent = () => { try { recent.value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, MAX_RECENT); } catch (e) { recent.value = []; } };
const remember = (value) => {
    const v = String(value || '').trim();
    if (v.length < 2) return;
    recent.value = [v, ...recent.value.filter((x) => x !== v)].slice(0, MAX_RECENT);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value)); } catch (e) { /* session only */ }
};

const search = debounce(() => {
    const value = query.value.trim();
    if (value.length < 2) { records.value = { tasks: [], projects: [], pages: [], comments: [] }; searching.value = false; return; }
    searching.value = true;
    apiRequest('post', env.GLOBAL_SEARCH, { query: value }).then((res) => {
        if (res?.data?.status && query.value.trim() === value) {
            const d = res.data.data || {};
            records.value = { tasks: d.tasks || [], projects: d.projects || [], pages: d.pages || [], comments: d.comments || [] };
        }
    }).catch(() => {}).finally(() => { searching.value = false; });
}, 250);
const onInput = () => { active.value = 0; if (query.value.trim().length >= 2) searching.value = true; search(); };

const loadConnections = () => {
    apiRequest('get', `${env.INTEGRATIONS}/connections`).then((res) => {
        if (res?.data?.status) connections.value = (res.data.data || []).filter((c) => c.enabled !== false && c.status !== 'disconnected');
    }).catch(() => {});
};

const close = () => emit('closeModel', true);
const clearQuery = () => { query.value = ''; records.value = { tasks: [], projects: [], pages: [], comments: [] }; active.value = 0; nextTick(() => inputEl.value?.focus()); };
const go = (loc) => { close(); router.push(loc).catch(() => {}); };

const openTask = (task) => {
    const base = `/${cid.value}/project/${task.ProjectID}`;
    go(task.folderObjId ? `${base}/fs/${task.folderObjId}/${task.sprintId}/${task._id}` : `${base}/s/${task.sprintId}/${task._id}`);
};
const openProject = (p) => {
    const base = `/${cid.value}/project/${p._id}`;
    if (!p.sprintId) return go(`${base}/p?tab=ProjectListView`);
    return go(p.folderId ? `${base}/fs/${p.folderId}/${p.sprintId}?tab=ProjectListView` : `${base}/s/${p.sprintId}?tab=ProjectListView`);
};
const openPage = (p) => go({ name: 'Pages', params: { cid: cid.value }, query: { page: String(p._id) } });
const openPerson = (u) => {
    if (router.hasRoute('Members')) return go({ name: 'Members', params: { cid: cid.value }, query: { q: u.Employee_Email || u.Employee_Name } });
    return close();
};
const askAi = () => {
    remember(query.value);
    go({ name: 'AiHub', params: { cid: cid.value }, query: { q: query.value.trim() } });
};

const command = (key) => {
    if (key === 'toggle-theme') { toggleTheme(); close(); return; }
    if (key === 'logout') { close(); logOut({ islogOut: true }); return; }
    window.dispatchEvent(new CustomEvent('ah:command', { detail: { command: key, query: query.value.trim() } }));
    if (key === 'new-task' || key === 'new-project') return go({ name: 'Projects', params: { cid: cid.value }, query: { create: key === 'new-task' ? 'task' : 'project', name: query.value.trim() || undefined } });
    if (key === 'start-timer') { const r = timesheetRoute(); return r ? go(to(r)) : close(); }
    return close();
};

const run = (row) => {
    if (!row) return;
    if (row.kind === 'recent') { query.value = row.value; onInput(); return; }
    if (row.kind !== 'command') remember(query.value);
    if (row.kind === 'nav') return go(to(row.route));
    if (row.kind === 'task') return openTask(row.task);
    if (row.kind === 'project') return openProject(row.project);
    if (row.kind === 'page') return openPage(row.page);
    if (row.kind === 'person') return openPerson(row.user);
    if (row.kind === 'app') return go(router.hasRoute('IntegrationsHub') ? to('IntegrationsHub') : to('Integrations'));
    if (row.kind === 'ask') return askAi();
    if (row.kind === 'command') return command(row.command);
    return close();
};

const scrollActive = async () => {
    await nextTick();
    bodyEl.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' });
};
const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active.value = Math.min(flat.value.length - 1, active.value + 1); scrollActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = Math.max(0, active.value - 1); scrollActive(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const first = flat.value.find((r) => r.kind === 'command');
        if (first) run(first);
    } else if (e.key === 'Enter') { e.preventDefault(); run(flat.value[active.value]); }
};

watch(flat, (rows) => { if (active.value > rows.length - 1) active.value = 0; });

onMounted(() => {
    loadRecent();
    loadConnections();
    nextTick(() => inputEl.value?.focus());
});
</script>
