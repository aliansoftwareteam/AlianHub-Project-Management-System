import { computed, inject, ref, shallowRef, watch } from 'vue';
import { useStore } from 'vuex';
import { cleanViewSettings, DEFAULT_VIEW_SETTINGS, FILTERABLE_VIEWS, SAVED_SETTINGS_VIEWS, resolveActiveView, sameSettings, settingsFromPrefs, viewKeyOf } from './savedViewSettings';
import { clearViewPrefs, loadViewPrefs } from './projectViewPrefs';
import { VIEW_COLUMN_SETS, clearColumnState, loadColumnState, settingsFromColumnState } from './viewColumns';
import * as api from './savedViewApi';

const PRIVATE_ID_LENGTH = 10;
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const COPIED_FIELDS = ['_id', 'keyName', 'name', 'value', 'icon', 'activeIcon', 'sortIndex'];

const privateViewId = () => Array.from({ length: PRIVATE_ID_LENGTH }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('');

const copyOf = (view) => Object.fromEntries(COPIED_FIELDS.filter((field) => view?.[field] !== undefined).map((field) => [field, view[field]]));

/* The views' saved settings and the screen's current ones. `search` is useProjectSearch;
   sort, columns, the workload unit and the density live here because only the views that render them read them. */
export function useSavedViews({ project, activeTab, views, requestedViewKey, companyUser, search, canSaveShared, onSelect = () => {} }) {
    const { commit } = useStore();
    const userId = inject('$userId', ref(''));
    const companyId = inject('$companyId', ref(''));

    const sort = ref(null);
    const columns = ref(cleanViewSettings(DEFAULT_VIEW_SETTINGS).columns);
    const workloadUnit = ref(DEFAULT_VIEW_SETTINGS.workloadUnit);
    const density = ref(DEFAULT_VIEW_SETTINGS.density);
    const saving = ref(false);
    const drafts = new Map();
    const closed = () => ({ key: '', saved: cleanViewSettings(DEFAULT_VIEW_SETTINGS) });
    const opened = shallowRef(closed());

    const projectId = computed(() => String(project.value?._id || ''));
    const activeView = computed(() => resolveActiveView(views.value, activeTab.value, requestedViewKey?.value));
    const activeKey = computed(() => (activeView.value ? `${projectId.value}:${viewKeyOf(activeView.value)}` : ''));
    const hasSettings = computed(() => Boolean(activeView.value) && SAVED_SETTINGS_VIEWS.includes(activeTab.value));
    const savedSettings = computed(() => cleanViewSettings(activeView.value?.settings));
    const currentSettings = computed(() => cleanViewSettings({ ...search.viewState(), sort: sort.value, columns: columns.value, workloadUnit: workloadUnit.value, density: density.value }));
    const dirty = computed(() => hasSettings.value && opened.value.key === activeKey.value && !sameSettings(currentSettings.value, opened.value.saved));

    const prefsIds = () => ({ companyId: companyId.value, userId: userId.value, projectId: projectId.value });
    const columnSet = () => VIEW_COLUMN_SETS[activeTab.value];

    /* What older builds kept in this browser: group, "Me", search and done-by per project,
       and the chosen columns per project and view kind. */
    function legacySettings() {
        const prefs = settingsFromPrefs(loadViewPrefs(prefsIds()));
        const columns = columnSet() ? settingsFromColumnState(loadColumnState(prefsIds(), columnSet())) : undefined;
        return cleanViewSettings({ ...prefs, columns });
    }

    function forgetLegacy() {
        clearViewPrefs(prefsIds());
        if (columnSet()) clearColumnState(prefsIds(), columnSet());
    }

    function apply(settings) {
        const clean = cleanViewSettings(settings);
        sort.value = clean.sort;
        columns.value = clean.columns;
        workloadUnit.value = clean.workloadUnit;
        density.value = clean.density;
        search.applyViewState(clean);
    }

    function openingSettings(view) {
        if (drafts.has(activeKey.value)) return drafts.get(activeKey.value);
        if (view?.settings) return view.settings;
        if (!FILTERABLE_VIEWS.includes(activeTab.value)) return DEFAULT_VIEW_SETTINGS;
        const legacy = legacySettings();
        return sameSettings(legacy, DEFAULT_VIEW_SETTINGS) ? DEFAULT_VIEW_SETTINGS : legacy;
    }

    watch(activeKey, (key) => {
        const { key: previousKey, saved: previousSaved } = opened.value;
        if (previousKey && !sameSettings(currentSettings.value, previousSaved)) drafts.set(previousKey, currentSettings.value);
        else drafts.delete(previousKey);
        if (!key || !hasSettings.value) {
            opened.value = closed();
            apply(DEFAULT_VIEW_SETTINGS);
            return;
        }
        opened.value = { key, saved: savedSettings.value };
        apply(openingSettings(activeView.value));
    }, { immediate: true, flush: 'post' });

    watch(savedSettings, (next, previous) => {
        if (!opened.value.key || opened.value.key !== activeKey.value || sameSettings(next, previous)) return;
        const untouched = sameSettings(currentSettings.value, previous);
        opened.value = { key: opened.value.key, saved: next };
        if (untouched) apply(next);
    });

    const setSort = (value) => { sort.value = cleanViewSettings({ sort: value }).sort; };
    const setColumns = (value) => { columns.value = cleanViewSettings({ columns: value }).columns; };
    const setWorkloadUnit = (value) => { workloadUnit.value = cleanViewSettings({ workloadUnit: value }).workloadUnit; };
    const setDensity = (value) => { density.value = cleanViewSettings({ density: value }).density; };

    const myPrivateViews = () => (companyUser.value?.ProjectRequiredComponent || []);

    function storePrivateViews(next) {
        commit('settings/mutateCompanyUsers', { data: { ...companyUser.value, ProjectRequiredComponent: next }, op: 'modified' });
    }

    function settled(settings) {
        drafts.delete(activeKey.value);
        opened.value = { key: activeKey.value, saved: settings };
        forgetLegacy();
    }

    /* The changes now belong to the view being opened, so the one left behind keeps no draft. */
    function handOver(view) {
        drafts.delete(activeKey.value);
        opened.value = closed();
        forgetLegacy();
        onSelect(view);
    }

    async function run(task) {
        saving.value = true;
        try {
            return await task();
        } finally {
            saving.value = false;
        }
    }

    async function saveShared(view, settings) {
        if (!canSaveShared.value) throw new Error('You cannot change this view for everyone.');
        await api.saveSharedViewSettings(projectId.value, viewKeyOf(view), settings);
        commit('projectData/projectLocalUpdate', { itemData: { elementId: view._id, updateValue: settings, field: 'settings' }, projectId: projectId.value, key: 'ProjectView', subKey: 'edit', userId: '' });
    }

    async function savePrivate(view, settings) {
        await api.savePrivateViewSettings(companyUser.value._id, view.id, settings);
        storePrivateViews(myPrivateViews().map((entry) => (entry.id === view.id ? { ...entry, settings } : entry)));
    }

    async function addPrivate(source, title, settings) {
        const view = { ...copyOf(source), id: privateViewId(), isPrivate: true, isPin: false, projectId: projectId.value, sourceViewId: viewKeyOf(source), title, settings, createdAt: new Date() };
        await api.createPrivateView(companyUser.value._id, view);
        storePrivateViews([...myPrivateViews(), view]);
        return view;
    }

    const sharedSourceOf = (view) => {
        const shared = views.value.filter((entry) => !entry.isPrivate && entry.keyName === view.keyName);
        return shared.find((entry) => viewKeyOf(entry) === view.sourceViewId)
            || shared.find((entry) => String(entry._id) === String(view._id))
            || shared[0]
            || null;
    };

    const save = () => run(async () => {
        const view = activeView.value;
        const settings = currentSettings.value;
        if (view.isPrivate) await savePrivate(view, settings);
        else await saveShared(view, settings);
        settled(settings);
    });

    const saveForMe = () => run(async () => {
        const view = activeView.value;
        const settings = currentSettings.value;
        if (view.isPrivate) {
            await savePrivate(view, settings);
            settled(settings);
            return;
        }
        const mine = myPrivateViews().find((entry) => entry.projectId === projectId.value && entry.sourceViewId === viewKeyOf(view));
        const target = mine || await addPrivate(view, view.title || '', settings);
        if (mine) await savePrivate(mine, settings);
        handOver(target);
    });

    const saveAsNew = ({ title, isPrivate }) => run(async () => {
        const view = activeView.value;
        const settings = currentSettings.value;
        const source = view.isPrivate ? sharedSourceOf(view) : view;
        let created;
        if (isPrivate || !canSaveShared.value || !source) {
            created = await addPrivate(source || view, title, settings);
        } else {
            const response = await api.createSharedView(projectId.value, { sourceViewId: viewKeyOf(source), title, settings });
            created = response.data;
            commit('projectData/projectLocalUpdate', { itemData: created, projectId: projectId.value, key: 'ProjectView', subKey: 'add', userId: '' });
        }
        handOver(created);
    });

    function reset() {
        drafts.delete(activeKey.value);
        forgetLegacy();
        apply(opened.value.saved);
    }

    return { activeView, hasSettings, savedSettings, currentSettings, dirty, saving, sort, columns, workloadUnit, density, setSort, setColumns, setWorkloadUnit, setDensity, save, saveForMe, saveAsNew, reset };
}
