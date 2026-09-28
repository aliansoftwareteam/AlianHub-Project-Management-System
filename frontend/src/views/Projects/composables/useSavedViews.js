import { computed, inject, ref, shallowRef, watch } from 'vue';
import { useStore } from 'vuex';
import { cleanViewSettings, DEFAULT_VIEW_SETTINGS, FILTERABLE_VIEWS, resolveActiveView, sameSettings, settingsFromPrefs, viewKeyOf } from './savedViewSettings';
import { clearViewPrefs, loadViewPrefs } from './projectViewPrefs';
import * as api from './savedViewApi';

const PRIVATE_ID_LENGTH = 10;
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const COPIED_FIELDS = ['_id', 'keyName', 'name', 'value', 'icon', 'activeIcon', 'sortIndex'];

const privateViewId = () => Array.from({ length: PRIVATE_ID_LENGTH }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('');

const copyOf = (view) => Object.fromEntries(COPIED_FIELDS.filter((field) => view?.[field] !== undefined).map((field) => [field, view[field]]));

/* The views' saved settings and the screen's current ones. `search` is useProjectSearch;
   sort and columns live here because only the views that render them read them. */
export function useSavedViews({ project, activeTab, views, requestedViewKey, companyUser, search, canSaveShared, onSelect = () => {} }) {
    const { commit } = useStore();
    const userId = inject('$userId', ref(''));
    const companyId = inject('$companyId', ref(''));

    const sort = ref(null);
    const columns = ref([]);
    const saving = ref(false);
    const drafts = new Map();
    const closed = () => ({ key: '', saved: cleanViewSettings(DEFAULT_VIEW_SETTINGS) });
    const opened = shallowRef(closed());

    const projectId = computed(() => String(project.value?._id || ''));
    const activeView = computed(() => resolveActiveView(views.value, activeTab.value, requestedViewKey?.value));
    const activeKey = computed(() => (activeView.value ? `${projectId.value}:${viewKeyOf(activeView.value)}` : ''));
    const isFilterable = computed(() => Boolean(activeView.value) && FILTERABLE_VIEWS.includes(activeTab.value));
    const savedSettings = computed(() => cleanViewSettings(activeView.value?.settings));
    const currentSettings = computed(() => cleanViewSettings({ ...search.viewState(), sort: sort.value, columns: columns.value }));
    const dirty = computed(() => isFilterable.value && opened.value.key === activeKey.value && !sameSettings(currentSettings.value, opened.value.saved));

    const prefsIds = () => ({ companyId: companyId.value, userId: userId.value, projectId: projectId.value });

    function apply(settings) {
        const clean = cleanViewSettings(settings);
        sort.value = clean.sort;
        columns.value = clean.columns;
        search.applyViewState(clean);
    }

    function openingSettings(view) {
        if (drafts.has(activeKey.value)) return drafts.get(activeKey.value);
        if (view?.settings) return view.settings;
        const prefs = settingsFromPrefs(loadViewPrefs(prefsIds()));
        return sameSettings(prefs, DEFAULT_VIEW_SETTINGS) ? DEFAULT_VIEW_SETTINGS : prefs;
    }

    watch(activeKey, (key) => {
        const { key: previousKey, saved: previousSaved } = opened.value;
        if (previousKey && !sameSettings(currentSettings.value, previousSaved)) drafts.set(previousKey, currentSettings.value);
        else drafts.delete(previousKey);
        if (!key || !isFilterable.value) {
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

    const myPrivateViews = () => (companyUser.value?.ProjectRequiredComponent || []);

    function storePrivateViews(next) {
        commit('settings/mutateCompanyUsers', { data: { ...companyUser.value, ProjectRequiredComponent: next }, op: 'modified' });
    }

    function settled(settings) {
        drafts.delete(activeKey.value);
        opened.value = { key: activeKey.value, saved: settings };
        clearViewPrefs(prefsIds());
    }

    /* The changes now belong to the view being opened, so the one left behind keeps no draft. */
    function handOver(view) {
        drafts.delete(activeKey.value);
        opened.value = closed();
        clearViewPrefs(prefsIds());
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
        clearViewPrefs(prefsIds());
        apply(opened.value.saved);
    }

    return { activeView, isFilterable, savedSettings, currentSettings, dirty, saving, sort, columns, setSort, setColumns, save, saveForMe, saveAsNew, reset };
}
