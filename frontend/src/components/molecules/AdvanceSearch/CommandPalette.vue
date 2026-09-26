<template>
    <teleport to="#my-modal">
        <div v-if="open" class="pal-layer">
            <div class="pal-backdrop" aria-hidden="true" @click="close"></div>
            <div
                ref="dialogEl"
                class="pal"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                tabindex="-1"
                @keydown="onDialogKey"
            >
                <h2 :id="titleId" class="ah-sr-only">{{ $t('Palette.title') }}</h2>
                <div class="pal__field">
                    <ShellIcon name="search" :size="15" class="pal__glass" />
                    <input
                        ref="inputEl"
                        v-model="query"
                        type="text"
                        class="pal__input"
                        role="combobox"
                        aria-autocomplete="list"
                        :aria-expanded="flat.length ? 'true' : 'false'"
                        :aria-controls="listId"
                        :aria-activedescendant="activeRow ? optionId(activeRow) : undefined"
                        :aria-label="$t('Palette.input_label')"
                        :placeholder="$t('Inbox.search_placeholder')"
                        autocomplete="off"
                        spellcheck="false"
                        @input="onInput"
                        @keydown="onInputKey"
                    />
                    <span v-if="searching" class="pal__spin" aria-hidden="true"></span>
                    <button type="button" class="ah-kbd pal__esc" :aria-label="$t('Palette.close')" @click="close">{{ $t('Shell.palette_esc') }}</button>
                </div>

                <div class="pal__chips" role="group" :aria-label="$t('Palette.filter_label')">
                    <button
                        v-for="c in chips"
                        :key="c"
                        type="button"
                        class="pal__chip"
                        :class="{ 'is-on': chip === c }"
                        :data-chip="c"
                        :aria-pressed="chip === c ? 'true' : 'false'"
                        @click="setChip(c)"
                    >{{ $t('Palette.chip_' + c) }}</button>
                </div>

                <div ref="bodyEl" class="pal__body ah-scroll">
                    <div v-if="flat.length" :id="listId" role="listbox" class="pal__list" :aria-label="$t('Palette.results_label')">
                        <div v-for="g in groups" :key="g.key" role="group" :aria-labelledby="groupId(g)">
                            <div :id="groupId(g)" class="pal__group" aria-hidden="true">{{ g.label }}</div>
                            <div
                                v-for="row in g.rows"
                                :id="optionId(row)"
                                :key="row.id"
                                role="option"
                                class="pal__row"
                                :class="{ 'is-active': row.index === active, 'is-ask': row.kind === 'ask', 'has-actions': hasActions(row) }"
                                :aria-selected="row.index === active ? 'true' : 'false'"
                                :data-kind="row.kind"
                                :data-index="row.index"
                                @mouseenter="active = row.index"
                                @mousedown.prevent
                                @click="run(row)"
                            >
                                <span v-if="row.avatar" class="ah-avatar ah-avatar--sm pal__avatar">
                                    <img v-if="row.avatar.image" :src="row.avatar.image" alt="" />
                                    <template v-else>{{ row.avatar.initial }}</template>
                                </span>
                                <span v-else-if="row.swatch" class="pal__swatch" :style="{ background: row.swatch }"></span>
                                <span v-else class="pal__icon" :class="row.iconClass"><ShellIcon :name="row.icon || 'dot'" :size="12" /></span>
                                <span class="pal__text">
                                    <span class="pal__title" :class="{ 'is-bold': row.bold }">
                                        <span v-if="row.code" class="pal__code">{{ row.code }}</span>{{ row.title }}
                                    </span>
                                    <span v-if="row.sub" class="pal__sub">{{ row.sub }}</span>
                                </span>
                                <span v-if="row.age" class="pal__age">{{ row.age }}</span>
                                <span v-else-if="row.hint" class="pal__hint">{{ row.hint }}</span>
                            </div>
                        </div>
                    </div>

                    <div
                        v-if="actionRow"
                        ref="toolbarEl"
                        class="pal__actions"
                        role="toolbar"
                        :aria-label="$t('Palette.actions_for', { title: actionRow.title })"
                        :style="toolbarStyle"
                        @keydown="onToolbarKey"
                    >
                        <button type="button" class="pal__action" :aria-label="$t('Palette.action_open')" :title="$t('Palette.action_open')" @click="run(actionRow)">
                            <ShellIcon name="chevron" :size="13" />
                        </button>
                        <button type="button" class="pal__action" :aria-label="$t('Palette.action_new_tab')" :title="$t('Palette.action_new_tab')" @click="openInNewTab(actionRow)">
                            <ShellIcon name="external" :size="13" />
                        </button>
                        <button type="button" class="pal__action" :aria-label="$t('Palette.action_copy')" :title="$t('Palette.action_copy')" @click="copyLink(actionRow)">
                            <ShellIcon name="link" :size="13" />
                        </button>
                        <button v-if="hasAi" type="button" class="pal__action pal__action--ai" :aria-label="$t('Palette.action_ask')" :title="$t('Palette.action_ask')" @click="askAi(actionRow)">
                            <ShellIcon name="ai" :size="13" />
                        </button>
                    </div>

                    <div v-if="!flat.length && query.trim().length >= 2 && !searching" class="pal__empty">
                        <span class="pal__icon pal__icon--brand"><ShellIcon name="search" :size="13" /></span>
                        <div class="pal__empty-title">{{ $t('Inbox.search_nothing', { q: query.trim() }) }}</div>
                        <div class="pal__empty-sub">{{ $t('Inbox.search_nothing_sub', { n: sourceCount }) }}</div>
                        <div class="pal__empty-actions">
                            <button v-if="hasAi" type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="askAi()">✦ {{ $t('Inbox.ask_ai') }}</button>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="clearQuery">{{ $t('Inbox.clear_search') }}</button>
                        </div>
                    </div>
                    <div v-else-if="!flat.length" class="pal__empty pal__empty--idle">
                        <div class="pal__empty-sub">{{ chip === 'all' ? $t('Inbox.search_idle') : $t('Palette.type_to_search', { type: $t('Palette.chip_' + chip) }) }}</div>
                    </div>
                </div>

                <div class="pal__foot">
                    <span><kbd>↑↓</kbd> {{ $t('Inbox.hint_move') }}</span>
                    <span><kbd>↵</kbd> {{ $t('Inbox.hint_open') }}</span>
                    <span><kbd>{{ modEnter }}</kbd> {{ $t('Palette.hint_new_tab') }}</span>
                    <span><kbd>{{ $t('Palette.key_tab') }}</kbd> {{ $t('Palette.hint_actions') }}</span>
                    <span><kbd>{{ $t('Palette.key_esc') }}</kbd> {{ $t('Palette.hint_close') }}</span>
                </div>
            </div>
        </div>
    </teleport>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { apiRequest, useAuth } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable } from '@/composable';
import { useFocusTrap } from '@/composable/useFocusTrap';
import { aiOff } from '@/composable/aiAvailability';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { toggleTheme, shellState } from '@/components/organisms/Shell/shellState';
import { isMacPlatform } from './paletteKeys';
import { CHIPS, RECORD_CHIPS, chipAllows, commandArgument, commandLeads, projectPath, relativeAge, taskLocation, taskPath } from './paletteRows';
import { openQuickCreate } from '@/components/organisms/QuickCreateTask/quickCreateTask';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import '@/components/molecules/AdvanceSearch/style.css';

defineOptions({ name: 'CommandPalette' });

const props = defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['close']);
const router = useRouter();
const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { debounce, checkPermission } = useCustomComposable();
const { logOut } = useAuth();
const companyId = inject('$companyId');

const RECENT_KEY = 'alianhub.search.recent';
const MAX_RECENT = 6;
const MAX_PER_GROUP = 5;
const MAX_PER_CHIP = 10;
const EMPTY_RECORDS = () => ({ tasks: [], projects: [], pages: [], comments: [] });

const instance = `pal-${Math.random().toString(36).slice(2, 8)}`;
const titleId = `${instance}-title`;
const listId = `${instance}-list`;
const optionId = (row) => `${instance}-opt-${row.index}`;
const groupId = (g) => `${instance}-grp-${g.key}`;

const dialogEl = ref(null);
const inputEl = ref(null);
const bodyEl = ref(null);
const toolbarEl = ref(null);
const query = ref('');
const chip = ref('all');
const active = ref(0);
const searching = ref(false);
const records = ref(EMPTY_RECORDS());
const connections = ref([]);
const recentSearches = ref([]);
const recentTasks = ref([]);
const toolbarStyle = ref({});

useFocusTrap(dialogEl, computed(() => props.open));

const mac = isMacPlatform();
const modEnter = computed(() => (mac ? '⌘↵' : t('Palette.key_ctrl_enter')));
const cid = computed(() => companyId?.value || '');
const hasAi = computed(() => !aiOff.value && router.hasRoute('AiAsk'));
const canSearchRecords = computed(() => checkPermission('task.advance_search') === true);
const chips = computed(() => CHIPS.filter((c) => canSearchRecords.value || !RECORD_CHIPS.includes(c)));
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
    { key: 'ask', label: t('Palette.action_ask'), icon: 'ai', route: 'AiAsk' },
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
    { key: 'new-task', label: t('Inbox.cmd_new_task'), icon: 'plus' },
    { key: 'new-project', label: t('Inbox.cmd_new_project'), icon: 'projects', show: allowed('project.project_list'), takesName: true },
    { key: 'start-timer', label: t('Inbox.cmd_start_timer'), icon: 'play', show: !!timesheetRoute() },
    { key: 'toggle-theme', label: shellState.theme === 'dark' ? t('Shell.theme_light') : t('Shell.theme_dark'), icon: shellState.theme === 'dark' ? 'sun' : 'moon' },
    { key: 'logout', label: t('Shell.logout'), icon: 'logout' },
].filter((c) => c.show !== false).map((c) => ({ ...c, alias: c.key.replace(/-/g, ' ') })));

const initialOf = (name) => String(name || '?').trim().charAt(0).toUpperCase();
const projectName = (id) => (getters['projectData/projects']?.data || []).find((p) => String(p._id) === String(id))?.ProjectName || '';

const taskRow = (task, when) => ({
    id: `task:${task._id}`, kind: 'task', swatch: task.status?.color || 'var(--brand)', bold: true,
    code: task.TaskKey && task.TaskKey !== '--' ? task.TaskKey : '', title: task.TaskName,
    sub: taskLocation(task, projectName(task.ProjectID)), age: relativeAge(when || task.updatedAt, t), to: taskPath(cid.value, task),
    task: { companyId: cid.value, projectId: task.ProjectID, sprintId: task.sprintId, folderId: task.folderObjId || '', taskId: task._id },
});
const projectRow = (p) => ({ id: `project:${p._id}`, kind: 'project', icon: 'projects', title: p.ProjectName, sub: t('Header.Projects'), age: relativeAge(p.updatedAt, t), to: projectPath(cid.value, p) });
const pageRow = (p) => ({
    id: `page:${p._id}`, kind: 'page', icon: 'docs', title: p.title || t('Docs.untitled'),
    sub: projectName(p.ProjectID) || t('Palette.docs_company'), age: relativeAge(p.updatedAt, t),
    to: { name: 'Pages', params: { cid: cid.value }, query: { page: String(p._id) } },
});
const personRow = (u) => ({
    id: `user:${u._id}`, kind: 'person', avatar: { image: u.Employee_profileImageURL || '', initial: initialOf(u.Employee_Name) },
    title: u.Employee_Name, sub: u.Employee_Email,
    to: router.hasRoute('Members') ? { name: 'Members', params: { cid: cid.value }, query: { q: u.Employee_Email || u.Employee_Name } } : null,
});
const navRow = (n) => ({ id: `nav:${n.key}`, kind: 'nav', icon: n.icon, title: n.label, sub: n.sub, to: to(n.route) });
const nameFor = (c) => (c.takesName ? commandArgument(query.value, [c.label, c.alias]) : '');
const commandRow = (c) => {
    const name = nameFor(c);
    return { id: `cmd:${c.key}`, kind: 'command', icon: c.icon, title: c.label, sub: name, command: c.key, name };
};

const groups = computed(() => {
    let index = 0;
    const out = [];
    const limit = chip.value === 'all' ? MAX_PER_GROUP : MAX_PER_CHIP;
    const add = (key, label, rows) => {
        const kept = rows.filter((r) => chipAllows(chip.value, r.kind)).slice(0, limit);
        if (kept.length) out.push({ key, label, rows: kept.map((r) => ({ ...r, index: index++ })) });
    };
    const people = () => users.value.filter((u) => matches(u.Employee_Name, u.Employee_Email)).map(personRow);

    if (!q.value) {
        add('recent_opened', t('Palette.group_recent_opened'), recentTasks.value.map((v) => taskRow(v.task, v.visitedAt)));
        add('recent', t('Inbox.group_recent'), recentSearches.value.map((r) => ({ id: `recent:${r}`, kind: 'recent', icon: 'search', title: r, value: r })));
        if (chip.value === 'people') add('people', t('Inbox.group_people'), people());
        if (chip.value === 'all') add('navigation', t('Inbox.group_navigation'), NAV.value.slice(0, 8).map(navRow));
        add('commands', t('Inbox.group_commands'), COMMANDS.value.map(commandRow));
        return out;
    }

    const commands = COMMANDS.value.filter((c) => matches(c.label, c.alias) || nameFor(c)).slice(0, 3);
    const addCommands = () => add('commands', t('Inbox.group_commands'), commands.map(commandRow));
    const commandsLead = commandLeads(query.value, commands.flatMap((c) => [c.label, c.alias]));
    if (commandsLead) addCommands();

    if (q.value.length >= 2) {
        add('tasks', t('Palette.chip_tasks'), records.value.tasks.map((task) => taskRow(task)));
        add('projects', t('Palette.chip_projects'), records.value.projects.map(projectRow));
        add('docs', t('Palette.chip_docs'), records.value.pages.map(pageRow));
        add('people', t('Inbox.group_people'), people());
    }
    add('navigation', t('Inbox.group_navigation'), NAV.value.filter((n) => matches(n.label, n.key, n.sub)).map(navRow));
    if (q.value.length >= 2) {
        add('apps', t('Inbox.group_apps'), connections.value.filter((c) => matches(c.name, c.type)).map((c) => ({
            id: `app:${c._id}`, kind: 'app', icon: /github|gitlab/i.test(c.type) ? 'github' : 'integrations', iconClass: 'pal__icon--dark',
            title: c.name, sub: t('Inbox.app_connected'), to: router.hasRoute('IntegrationsHub') ? to('IntegrationsHub') : to('Integrations'),
        })));
    }
    if (!commandsLead) addCommands();
    if (q.value.length >= 2 && hasAi.value) {
        add('ask', t('Inbox.group_ask'), [{ id: 'ask', kind: 'ask', icon: 'ai', iconClass: 'pal__icon--brand', bold: true, title: t('Inbox.ask_query', { q: query.value.trim() }), hint: '↵' }]);
    }
    return out;
});
const flat = computed(() => groups.value.flatMap((g) => g.rows));
const activeRow = computed(() => flat.value[active.value] || null);
const hasActions = (row) => Boolean(row && row.to && row.kind !== 'nav' && row.kind !== 'app');
const actionRow = computed(() => (hasActions(activeRow.value) ? activeRow.value : null));
const sourceCount = computed(() => 2 + (connections.value.length ? 1 : 0) + (hasAi.value ? 1 : 0));

const loadRecentSearches = () => {
    try { recentSearches.value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, MAX_RECENT); } catch (e) { recentSearches.value = []; }
};
const remember = (value) => {
    const v = String(value || '').trim();
    if (v.length < 2) return;
    recentSearches.value = [v, ...recentSearches.value.filter((x) => x !== v)].slice(0, MAX_RECENT);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches.value)); } catch (e) { /* storage may be unavailable */ }
};
const loadRecentTasks = () => {
    apiRequest('get', env.RECENT_VISITS).then((res) => {
        if (res?.data?.status) recentTasks.value = (res.data.data || []).filter((v) => v && v.task);
    }).catch(() => {});
};
const loadConnections = () => {
    apiRequest('get', `${env.INTEGRATIONS}/connections`).then((res) => {
        if (res?.data?.status) connections.value = (res.data.data || []).filter((c) => c.enabled !== false && c.status !== 'disconnected');
    }).catch(() => {});
};

const search = debounce(() => {
    const value = query.value.trim();
    if (value.length < 2 || !canSearchRecords.value) { records.value = EMPTY_RECORDS(); searching.value = false; return; }
    searching.value = true;
    return apiRequest('post', env.GLOBAL_SEARCH, { query: value }).then((res) => {
        if (res?.data?.status && query.value.trim() === value) {
            const d = res.data.data || {};
            records.value = { tasks: d.tasks || [], projects: d.projects || [], pages: d.pages || [], comments: d.comments || [] };
        }
    }).catch(() => {}).finally(() => { searching.value = false; });
}, 250);
const onInput = () => {
    active.value = 0;
    if (query.value.trim().length >= 2 && canSearchRecords.value) searching.value = true;
    search();
};

const close = () => emit('close');
const focusInput = () => nextTick(() => inputEl.value?.focus());
const clearQuery = () => { query.value = ''; records.value = EMPTY_RECORDS(); active.value = 0; focusInput(); };
const setChip = (c) => { chip.value = c; active.value = 0; };
const go = (loc) => { close(); router.push(loc).catch(() => {}); };

const urlOf = (row) => new URL(router.resolve(row.to).href, window.location.href).href;
const openInNewTab = (row) => {
    if (!row?.to) return;
    remember(query.value);
    window.open(urlOf(row), '_blank', 'noopener,noreferrer');
};
const copyLink = async (row) => {
    try {
        await navigator.clipboard.writeText(urlOf(row));
        $toast.success(t('Palette.link_copied'), { position: 'top-right' });
    } catch (e) {
        $toast.error(t('Palette.copy_failed'), { position: 'top-right' });
    }
};
const askAi = (row) => {
    const text = query.value.trim() || row?.title || '';
    remember(query.value);
    go({ name: 'AiAsk', params: { cid: cid.value }, query: text ? { q: text } : {} });
};

const command = (key, name = '') => {
    if (key === 'toggle-theme') { toggleTheme(); close(); return; }
    if (key === 'logout') { close(); logOut({ islogOut: true }); return; }
    window.dispatchEvent(new CustomEvent('ah:command', { detail: { command: key, query: query.value.trim() } }));
    if (key === 'new-task') { close(); openQuickCreate(); return; }
    if (key === 'new-project') return go({ name: 'Projects', params: { cid: cid.value }, query: { create: 'project', name: name || undefined } });
    if (key === 'start-timer') { const r = timesheetRoute(); return r ? go(to(r)) : close(); }
    return close();
};

const run = (row) => {
    if (!row) return;
    if (row.kind === 'recent') { query.value = row.value; onInput(); focusInput(); return; }
    if (row.kind === 'command') return command(row.command, row.name);
    remember(query.value);
    if (row.kind === 'ask') return askAi();
    if (row.task) { close(); openTask(row.task); return; }
    if (row.to) return go(row.to);
    return close();
};

const placeToolbar = async () => {
    await nextTick();
    const el = activeRow.value && bodyEl.value?.querySelector(`[data-index="${active.value}"]`);
    if (!el) return;
    el.scrollIntoView?.({ block: 'nearest' });
    toolbarStyle.value = { top: `${el.offsetTop}px`, height: `${el.offsetHeight}px` };
};

const move = (delta) => {
    if (!flat.value.length) return;
    active.value = Math.min(flat.value.length - 1, Math.max(0, active.value + delta));
};

const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (activeRow.value?.to) openInNewTab(activeRow.value); else run(activeRow.value);
    } else if (e.key === 'Enter') { e.preventDefault(); run(activeRow.value); }
    else if (e.key === 'Tab' && !e.shiftKey && actionRow.value) {
        e.preventDefault();
        toolbarEl.value?.querySelector('button')?.focus();
    } else if (e.key === 'Tab' && e.shiftKey) {
        const pressed = dialogEl.value?.querySelector('.pal__chip[aria-pressed="true"]');
        if (pressed) { e.preventDefault(); pressed.focus(); }
    }
};

const onToolbarKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const buttons = Array.from(toolbarEl.value?.querySelectorAll('button') || []);
    const at = buttons.indexOf(document.activeElement);
    if (at === -1) return;
    e.preventDefault();
    buttons[(at + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus();
};

const onDialogKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
};

watch(flat, (rows) => { if (active.value > rows.length - 1) active.value = 0; });
watch([active, flat], placeToolbar);
watch(() => props.open, (on) => {
    if (!on) return;
    query.value = '';
    chip.value = 'all';
    active.value = 0;
    records.value = EMPTY_RECORDS();
    loadRecentSearches();
    loadRecentTasks();
    loadConnections();
}, { immediate: true });
watch(() => props.open, (on) => { if (on) inputEl.value?.focus(); }, { flush: 'post' });
onMounted(() => { if (props.open) inputEl.value?.focus(); });
</script>
