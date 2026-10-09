<template>
    <div class="ah-page dash">
        <header class="ah-toolbar dash__toolbar">
            <div class="ah-toolbar__title">{{ $t('Dash.dashboards') }}</div>
            <nav class="dash__tabs">
                <button
                    v-for="tab in tabs"
                    :key="tab.id"
                    type="button"
                    class="dash__tab"
                    :class="{ 'is-active': activeTab === tab.id }"
                    @click="activeTab = tab.id"
                >{{ $t(tab.labelKey) }}</button>
            </nav>
            <span class="ah-toolbar__spacer"></span>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openCreate()">{{ $t('Dash.new_dashboard') }}</button>
        </header>

        <div class="ah-page__content ah-scroll dash__content">
            <p v-if="error" class="ah-empty">{{ error }}</p>

            <div v-else class="dash__hub-grid">
                <article v-for="d in visible" :key="d._id" class="dash__tile" @click="open(d)">
                    <div class="dash__tile-head">
                        <button type="button" class="dash__tile-title dash__tile-open" :title="d.title" @click.stop="open(d)">{{ d.title }}</button>
                        <span class="dash__tile-count">{{ $t('Dash.n_cards', { n: d.cardCount }, d.cardCount) }}</span>
                        <div class="dash__pop-anchor" @click.stop>
                            <button type="button" class="dash__tile-menu" :aria-expanded="menuFor === d._id" :title="$t('Dash.more')" @click="menuFor = menuFor === d._id ? '' : d._id">
                                <ShellIcon name="dots" :size="14" />
                            </button>
                            <transition name="ah-fade">
                                <div v-if="menuFor === d._id" class="ah-pop dash__pop" role="menu">
                                    <button type="button" class="ah-pop__item" role="menuitem" @click="open(d)">{{ $t('Dash.open') }}</button>
                                    <button type="button" class="ah-pop__item" role="menuitem" @click="duplicate(d)">{{ $t('Dash.duplicate') }}</button>
                                    <template v-if="d.canEdit">
                                        <div class="ah-pop__sep"></div>
                                        <button type="button" class="ah-pop__item" role="menuitem" @click="askDelete(d)">{{ $t('Dash.delete') }}</button>
                                    </template>
                                </div>
                            </transition>
                        </div>
                    </div>

                    <div class="dash__preview">
                        <ul v-if="d.cardCount" class="dash__preview-list" :aria-label="$t('Dash.preview_label')">
                            <li v-for="card in d.summary.cards" :key="card.key" class="dash__preview-item">
                                <ShellIcon :name="card.icon" :size="12" />
                                <span class="dash__preview-name">{{ $t(card.titleKey) }}</span>
                            </li>
                            <li v-if="d.summary.more" class="dash__preview-more">
                                {{ d.summary.cards.length ? $t('Dash.preview_more', { n: d.summary.more }) : $t('Dash.preview_other', { n: d.summary.more }) }}
                            </li>
                        </ul>
                        <span v-else class="dash__preview-empty">{{ $t('Dash.no_cards_yet') }}</span>
                    </div>

                    <div class="dash__tile-foot">
                        <span class="ah-avatar ah-avatar--sm">{{ initials(d) }}</span>
                        <span class="dash__tile-meta">{{ ownerLine(d) }}</span>
                    </div>
                </article>

                <EmptyState
                    v-if="loaded && activeTab === 'shared' && !visible.length"
                    class="dash__empty"
                    data-test="dash-empty-shared"
                    :heading-level="2"
                    :title="$t('Dash.shared_empty_title')"
                    :message="$t('Dash.shared_empty_msg')"
                    :action-label="$t('Dash.shared_empty_action')"
                    @action="activeTab = 'all'"
                />

                <button type="button" class="dash__tile dash__tile--template" @click="openCreate('team')">
                    <span class="dash__template-title">{{ $t('Dash.start_from_template') }}</span>
                    <span class="dash__template-text">{{ $t('Dash.template_lede') }}</span>
                </button>
            </div>
        </div>

        <ConfirmDelete
            v-if="deleting"
            :title="$t('Dash.delete_title', { name: deleting.title })"
            :description="$t('Dash.delete_text')"
            :confirmLabel="$t('Dash.delete')"
            :busy="deleteBusy"
            @confirm="destroy"
            @cancel="deleting = null"
        />

        <div v-if="createOpen" class="dash__modal" @click.self="createOpen = false">
            <div class="dash__modal-panel">
                <h2 class="ah-h2">{{ $t('Dash.new_dashboard') }}</h2>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Dash.name') }}</span>
                    <input v-model="form.title" type="text" class="ah-input" :class="{ 'ah-input--error': formError }" :placeholder="$t('Dash.name_placeholder')" />
                    <span v-if="formError" class="ah-field__error">{{ formError }}</span>
                </label>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Dash.visibility') }}</span>
                    <select v-model="form.visibility" class="ah-input">
                        <option value="private">{{ $t('Dash.vis_private') }}</option>
                        <option value="workspace">{{ $t('Dash.vis_workspace') }}</option>
                    </select>
                </label>
                <fieldset class="dash__templates">
                    <legend class="ah-field__label">{{ $t('Dash.start_with') }}</legend>
                    <label v-for="tpl in TEMPLATES" :key="tpl.id" class="dash__template-opt">
                        <input v-model="form.template" type="radio" :value="tpl.id" class="ah-check" />
                        <span>
                            <span class="dash__template-name">{{ $t(tpl.labelKey) }}</span>
                            <span class="dash__template-desc">{{ $t(tpl.descKey) }}</span>
                        </span>
                    </label>
                </fieldset>
                <div class="dash__modal-actions">
                    <span class="ah-toolbar__spacer"></span>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="createOpen = false">{{ $t('Dash.cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="creating" @click="create">{{ $t('Dash.create') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, inject } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';
import ConfirmDelete from '@/components/atom/ConfirmDelete/ConfirmDelete.vue';
import { useToast } from 'vue-toast-notification';
import { CARD_CATALOG, catalogEntry } from '@/plugins/dashboard/cardCatalog';
import { fetchDashboards, createDashboard, duplicateDashboard, removeDashboard, makeCardUid } from '@/plugins/dashboard/dashboardsApi';

defineOptions({ name: 'DashboardsHub' });

const router = useRouter();
const { t } = useI18n();
const $toast = useToast();
const companyId = inject('$companyId', ref(''));

const tabs = [
    { id: 'all', labelKey: 'Dash.tab_all' },
    { id: 'mine', labelKey: 'Dash.tab_mine' },
    { id: 'shared', labelKey: 'Dash.tab_shared' },
];
const TEMPLATES = [
    { id: 'blank', labelKey: 'Dash.tpl_blank', descKey: 'Dash.tpl_blank_desc', cards: [] },
    { id: 'mine', labelKey: 'Dash.tpl_mine', descKey: 'Dash.tpl_mine_desc', cards: ['DueSoonCard', 'MyTimeCard'] },
    { id: 'team', labelKey: 'Dash.tpl_team', descKey: 'Dash.tpl_team_desc', cards: ['ProjectPulseCard', 'TasksByStatusCard', 'TeamLoggedVsEtaCard', 'FreeResourcesCard'] },
];

const dashboards = ref([]);
const activeTab = ref('all');
const loaded = ref(false);
const error = ref('');
const menuFor = ref('');
const createOpen = ref(false);
const creating = ref(false);
const formError = ref('');
const form = reactive({ title: '', visibility: 'private', template: 'blank' });

const PREVIEW_LIMIT = 4;
const FAMILY_ICONS = { mine: 'user', team: 'members', charts: 'reports', ai: 'ai' };

const summaryOf = (d) => {
    const inReadingOrder = [...(d.preview || [])].sort((a, b) => ((Number(a.y) || 0) - (Number(b.y) || 0)) || ((Number(a.x) || 0) - (Number(b.x) || 0)));
    const named = [];
    inReadingOrder.forEach((block) => {
        const entry = catalogEntry(block.componentId);
        if (entry && !named.some((card) => card.key === entry.key)) named.push({ key: entry.key, titleKey: entry.titleKey, icon: FAMILY_ICONS[entry.family] || 'dash' });
    });
    const cards = named.slice(0, PREVIEW_LIMIT);
    return { cards, more: Math.max(0, (Number(d.cardCount) || 0) - cards.length) };
};

const visible = computed(() => dashboards.value
    .filter((d) => {
        if (activeTab.value === 'mine') return d.isMine;
        if (activeTab.value === 'shared') return !d.isMine;
        return true;
    })
    .map((d) => ({ ...d, summary: summaryOf(d) })));

const initials = (d) => (d.ownerName || '?').trim().charAt(0).toUpperCase();

const sharedLabel = (d) => {
    if (d.visibility === 'workspace') return t('Dash.shared_workspace');
    if (d.visibility === 'project') return t('Dash.shared_project');
    return t('Dash.shared_only_me');
};
const ownerLine = (d) => `${d.ownerName || t('Dash.a_teammate')} · ${sharedLabel(d)} · ${relative(d.updatedAt)}`;

const relative = (iso) => {
    if (!iso) return t('Dash.updated_never');
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days <= 0) return t('Dash.updated_today');
    if (days === 1) return t('Dash.updated_yesterday');
    return t('Dash.updated_days', { n: days });
};

const open = (d) => {
    menuFor.value = '';
    router.push({ name: 'DashboardView', params: { cid: companyId.value, dashboardId: d._id } });
};

const openCreate = (template = 'blank') => {
    form.title = '';
    form.visibility = 'private';
    form.template = template;
    formError.value = '';
    createOpen.value = true;
};

const cardsForTemplate = (id) => {
    const tpl = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
    let y = 0;
    let rowHeight = 0;
    return tpl.cards.map((key, index) => {
        const entry = CARD_CATALOG.find((c) => c.key === key);
        const size = entry.size;
        const x = index % 2 === 0 ? 0 : 6;
        if (x === 0 && index > 0) { y += rowHeight; rowHeight = 0; }
        rowHeight = Math.max(rowHeight, size.h);
        return {
            componentId: key,
            uid: makeCardUid(),
            config: {
                cardData: entry.period !== null ? { timerange: entry.period } : {},
                filterData: [],
                position: { ...size, x, y, w: 6 },
            },
        };
    });
};

const create = async () => {
    if (!form.title.trim()) {
        formError.value = t('Dash.name_required');
        return;
    }
    creating.value = true;
    try {
        const created = await createDashboard({
            title: form.title.trim(),
            visibility: form.visibility,
            cards: cardsForTemplate(form.template),
        });
        createOpen.value = false;
        if (created && created._id) open(created);
    } catch (e) {
        formError.value = (e && e.response && e.response.data && e.response.data.message) || t('Dash.save_failed');
    } finally {
        creating.value = false;
    }
};

const duplicate = async (d) => {
    menuFor.value = '';
    try {
        const copy = await duplicateDashboard(d._id);
        if (copy) dashboards.value = [copy, ...dashboards.value];
    } catch (e) {
        error.value = t('Dash.save_failed');
    }
};

const deleting = ref(null);
const deleteBusy = ref(false);

const askDelete = (d) => {
    menuFor.value = '';
    deleting.value = d;
};

const destroy = async () => {
    const d = deleting.value;
    if (!d || deleteBusy.value) return;
    deleteBusy.value = true;
    try {
        await removeDashboard(d._id);
        dashboards.value = dashboards.value.filter((x) => x._id !== d._id);
        deleting.value = null;
        $toast.success(t('Dash.deleted', { name: d.title }), { position: 'top-right' });
    } catch (e) {
        deleting.value = null;
        $toast.error(t('Dash.delete_failed'), { position: 'top-right' });
    } finally {
        deleteBusy.value = false;
    }
};

const closeMenus = () => { menuFor.value = ''; };

onMounted(async () => {
    document.addEventListener('click', closeMenus);
    try {
        dashboards.value = await fetchDashboards();
    } catch (e) {
        error.value = t('Dash.load_failed');
    } finally {
        loaded.value = true;
    }
});
onBeforeUnmount(() => document.removeEventListener('click', closeMenus));
</script>

<style scoped src="./style.css"></style>
