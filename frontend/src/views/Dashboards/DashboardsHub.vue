<template>
    <div class="ah-page dash">
        <header class="ah-toolbar dash__toolbar">
            <div class="ah-toolbar__title">{{ $t('DashV2.dashboards') }}</div>
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
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openCreate()">{{ $t('DashV2.new_dashboard') }}</button>
        </header>

        <div class="ah-page__content ah-scroll dash__content">
            <p v-if="error" class="ah-empty">{{ error }}</p>

            <div v-else class="dash__hub-grid">
                <article v-for="d in visible" :key="d._id" class="dash__tile" @click="open(d)">
                    <div class="dash__tile-head">
                        <span class="dash__tile-title" :title="d.title">{{ d.title }}</span>
                        <span class="dash__tile-count">{{ $t('DashV2.n_cards', { n: d.cardCount }) }}</span>
                        <div class="dash__pop-anchor" @click.stop>
                            <button type="button" class="dash__tile-menu" :aria-expanded="menuFor === d._id" :title="$t('DashV2.more')" @click="menuFor = menuFor === d._id ? '' : d._id">
                                <ShellIcon name="dots" :size="14" />
                            </button>
                            <transition name="ah-fade">
                                <div v-if="menuFor === d._id" class="ah-pop dash__pop" role="menu">
                                    <button type="button" class="ah-pop__item" role="menuitem" @click="open(d)">{{ $t('DashV2.open') }}</button>
                                    <button type="button" class="ah-pop__item" role="menuitem" @click="duplicate(d)">{{ $t('DashV2.duplicate') }}</button>
                                    <template v-if="d.canEdit">
                                        <div class="ah-pop__sep"></div>
                                        <button type="button" class="ah-pop__item" role="menuitem" @click="destroy(d)">{{ $t('DashV2.delete') }}</button>
                                    </template>
                                </div>
                            </transition>
                        </div>
                    </div>

                    <div class="dash__preview" aria-hidden="true">
                        <span
                            v-for="(block, i) in previewBlocks(d)"
                            :key="i"
                            class="dash__preview-block"
                            :style="block"
                        ></span>
                        <span v-if="!d.cardCount" class="dash__preview-empty">{{ $t('DashV2.no_cards_yet') }}</span>
                    </div>

                    <div class="dash__tile-foot">
                        <span class="ah-avatar ah-avatar--sm">{{ initials(d) }}</span>
                        <span class="dash__tile-meta">{{ ownerLine(d) }}</span>
                    </div>
                </article>

                <button type="button" class="dash__tile dash__tile--template" @click="openCreate('team')">
                    <span class="dash__template-title">{{ $t('DashV2.start_from_template') }}</span>
                    <span class="dash__template-text">{{ $t('DashV2.template_lede') }}</span>
                </button>
            </div>
        </div>

        <div v-if="createOpen" class="dash__modal" @click.self="createOpen = false">
            <div class="dash__modal-panel">
                <h2 class="ah-h2">{{ $t('DashV2.new_dashboard') }}</h2>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('DashV2.name') }}</span>
                    <input v-model="form.title" type="text" class="ah-input" :class="{ 'ah-input--error': formError }" :placeholder="$t('DashV2.name_placeholder')" />
                    <span v-if="formError" class="ah-field__error">{{ formError }}</span>
                </label>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('DashV2.visibility') }}</span>
                    <select v-model="form.visibility" class="ah-input">
                        <option value="private">{{ $t('DashV2.vis_private') }}</option>
                        <option value="workspace">{{ $t('DashV2.vis_workspace') }}</option>
                    </select>
                </label>
                <fieldset class="dash__templates">
                    <legend class="ah-field__label">{{ $t('DashV2.start_with') }}</legend>
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
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="createOpen = false">{{ $t('DashV2.cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="creating" @click="create">{{ $t('DashV2.create') }}</button>
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
import { CARD_CATALOG } from '@/plugins/dashboard/cardCatalog';
import { fetchDashboards, createDashboard, duplicateDashboard, removeDashboard, makeCardUid } from '@/plugins/dashboard/dashboardsApi';

defineOptions({ name: 'DashboardsHub' });

const router = useRouter();
const { t } = useI18n();
const companyId = inject('$companyId', ref(''));

const tabs = [
    { id: 'all', labelKey: 'DashV2.tab_all' },
    { id: 'mine', labelKey: 'DashV2.tab_mine' },
    { id: 'shared', labelKey: 'DashV2.tab_shared' },
];
const TEMPLATES = [
    { id: 'blank', labelKey: 'DashV2.tpl_blank', descKey: 'DashV2.tpl_blank_desc', cards: [] },
    { id: 'mine', labelKey: 'DashV2.tpl_mine', descKey: 'DashV2.tpl_mine_desc', cards: ['DueSoonCard', 'MyTimeCard'] },
    { id: 'team', labelKey: 'DashV2.tpl_team', descKey: 'DashV2.tpl_team_desc', cards: ['ProjectPulseCard', 'TasksByStatusCard', 'TeamLoggedVsEtaCard', 'FreeResourcesCard'] },
];

const dashboards = ref([]);
const activeTab = ref('all');
const error = ref('');
const menuFor = ref('');
const createOpen = ref(false);
const creating = ref(false);
const formError = ref('');
const form = reactive({ title: '', visibility: 'private', template: 'blank' });

const visible = computed(() => dashboards.value.filter((d) => {
    if (activeTab.value === 'mine') return d.isMine;
    if (activeTab.value === 'shared') return !d.isMine;
    return true;
}));

const initials = (d) => (d.ownerName || '?').trim().charAt(0).toUpperCase();

const sharedLabel = (d) => {
    if (d.visibility === 'workspace') return t('DashV2.shared_workspace');
    if (d.visibility === 'project') return t('DashV2.shared_project');
    return t('DashV2.shared_only_me');
};
const ownerLine = (d) => `${d.ownerName || t('DashV2.a_teammate')} · ${sharedLabel(d)} · ${relative(d.updatedAt)}`;

const relative = (iso) => {
    if (!iso) return t('DashV2.updated_never');
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days <= 0) return t('DashV2.updated_today');
    if (days === 1) return t('DashV2.updated_yesterday');
    return t('DashV2.updated_days', { n: days });
};

const previewBlocks = (d) => {
    const blocks = (d.preview || []).filter((b) => Number.isFinite(Number(b.w)));
    const maxY = blocks.reduce((m, b) => Math.max(m, (Number(b.y) || 0) + (Number(b.h) || 1)), 0) || 1;
    return blocks.map((b) => ({
        left: `${((Number(b.x) || 0) / 12) * 100}%`,
        width: `${((Number(b.w) || 1) / 12) * 100}%`,
        top: `${((Number(b.y) || 0) / maxY) * 100}%`,
        height: `${((Number(b.h) || 1) / maxY) * 100}%`,
    }));
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
        formError.value = t('DashV2.name_required');
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
        formError.value = (e && e.response && e.response.data && e.response.data.message) || t('DashV2.save_failed');
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
        error.value = t('DashV2.save_failed');
    }
};

const destroy = async (d) => {
    menuFor.value = '';
    try {
        await removeDashboard(d._id);
        dashboards.value = dashboards.value.filter((x) => x._id !== d._id);
    } catch (e) {
        error.value = t('DashV2.save_failed');
    }
};

const closeMenus = () => { menuFor.value = ''; };

onMounted(async () => {
    document.addEventListener('click', closeMenus);
    try {
        dashboards.value = await fetchDashboards();
    } catch (e) {
        error.value = t('DashV2.load_failed');
    }
});
onBeforeUnmount(() => document.removeEventListener('click', closeMenus));
</script>

<style scoped src="./style.css"></style>
