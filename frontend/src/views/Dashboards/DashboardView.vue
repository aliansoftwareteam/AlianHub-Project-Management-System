<template>
    <div class="ah-page dash">
        <header class="ah-toolbar dash__toolbar">
            <router-link class="dash__back" :to="{ name: 'Dashboards', params: { cid: companyId } }" :title="$t('DashV2.all_dashboards')">
                <ShellIcon name="arrowLeft" :size="15" />
            </router-link>
            <div class="ah-toolbar__title">
                <span class="dash__title">{{ dashboard.title || $t('DashV2.dashboard') }}</span>
                <span class="ah-chip ah-chip--mono">{{ visibilityLabel }}</span>
            </div>
            <span class="ah-toolbar__spacer"></span>
            <span class="dash__owner">{{ ownerLine }}</span>
            <button v-if="dashboard.canEdit" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="locked = !locked">
                <ShellIcon :name="locked ? 'lock' : 'grip'" :size="13" />
                <span>{{ locked ? $t('DashV2.locked') : $t('DashV2.unlocked') }}</span>
            </button>
            <button v-if="dashboard.canEdit" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="pickerOpen = true">
                {{ $t('DashV2.add_card_short') }}
            </button>
            <div v-if="dashboard.canEdit" class="dash__pop-anchor" @click.stop>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
                    <ShellIcon name="dots" :size="15" />
                </button>
                <transition name="ah-fade">
                    <div v-if="menuOpen" class="ah-pop dash__pop" role="menu">
                        <button type="button" class="ah-pop__item" role="menuitem" @click="openSettings">{{ $t('DashV2.dashboard_settings') }}</button>
                        <button type="button" class="ah-pop__item" role="menuitem" @click="duplicate">{{ $t('DashV2.duplicate') }}</button>
                    </div>
                </transition>
            </div>
        </header>

        <div class="ah-page__content ah-scroll dash__content" :class="{ 'is-empty': !cards.length }">
            <p v-if="loadError" class="ah-empty">{{ loadError }}</p>

            <template v-else-if="cards.length">
                <GridLayout
                    v-if="wide"
                    :layout="cards"
                    :col-num="12"
                    :row-height="30"
                    :margin="[12, 12]"
                    :is-draggable="!locked && dashboard.canEdit"
                    :is-resizable="!locked && dashboard.canEdit"
                    :vertical-compact="true"
                    :use-css-transforms="true"
                    :responsive="false"
                    @layout-updated="onLayoutUpdated"
                >
                    <GridItem
                        v-for="item in cards"
                        :key="item.i"
                        :x="item.x"
                        :y="item.y"
                        :w="item.w"
                        :h="item.h"
                        :i="item.i"
                        :min-w="item.minW"
                        :max-w="item.maxW"
                        :min-h="item.minH"
                        :max-h="item.maxH"
                        @move="moving = true"
                        @resize="moving = true"
                    >
                        <DashboardCard
                            :title="cardTitle(item)"
                            :scope="cardScope(item)"
                            :period-options="periodOptions(item)"
                            :period-value="periodValue(item)"
                            :show-refresh="true"
                            :show-remove="dashboard.canEdit"
                            :link-label="linkLabel(item)"
                            :link-to="linkTo(item)"
                            :empty-text="emptyText(item)"
                            :empty-action="emptyAction(item)"
                            @period-change="(v) => setPeriod(item, v)"
                            @refresh="refresh(item)"
                            @retry="refresh(item)"
                            @remove="removeCard(item)"
                            @empty-action="goToLink(item)"
                        >
                            <component
                                :is="componentFor(item)"
                                :cardUID="item.i"
                                :componentId="item.componentId"
                                :cardData="item.cardData"
                                :filterData="item.filterData"
                                :refreshTrigger="refreshKeys[item.i] || 0"
                                :companyUserDetail="companyUserDetail"
                                :allProjectsArrayFilter="projects"
                                :taskStatusArray="taskStatusArray"
                            />
                        </DashboardCard>
                    </GridItem>
                </GridLayout>

                <div v-else class="dash__stack">
                    <div v-for="item in cards" :key="item.i" class="dash__stack-item" :style="{ height: item.h * 30 + 'px' }">
                        <DashboardCard
                            :title="cardTitle(item)"
                            :scope="cardScope(item)"
                            :period-options="periodOptions(item)"
                            :period-value="periodValue(item)"
                            :show-refresh="true"
                            :show-remove="dashboard.canEdit"
                            :link-label="linkLabel(item)"
                            :link-to="linkTo(item)"
                            :empty-text="emptyText(item)"
                            :empty-action="emptyAction(item)"
                            @period-change="(v) => setPeriod(item, v)"
                            @refresh="refresh(item)"
                            @retry="refresh(item)"
                            @remove="removeCard(item)"
                            @empty-action="goToLink(item)"
                        >
                            <component
                                :is="componentFor(item)"
                                :cardUID="item.i"
                                :componentId="item.componentId"
                                :cardData="item.cardData"
                                :filterData="item.filterData"
                                :refreshTrigger="refreshKeys[item.i] || 0"
                                :companyUserDetail="companyUserDetail"
                                :allProjectsArrayFilter="projects"
                                :taskStatusArray="taskStatusArray"
                            />
                        </DashboardCard>
                    </div>
                </div>
            </template>

            <div v-else-if="!loading" class="ah-empty dash__empty">
                <p class="dash__empty-text">{{ $t('DashV2.empty_dashboard') }}</p>
                <button v-if="dashboard.canEdit" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="pickerOpen = true">
                    {{ $t('DashV2.add_first_card') }}
                </button>
            </div>

            <p v-if="hiddenCount" class="dash__hidden">{{ $t('DashV2.hidden_cards', { n: hiddenCount }) }}</p>
        </div>

        <CardPicker
            v-if="pickerOpen"
            :added="cards.map((c) => c.componentId)"
            @add="addCard"
            @close="pickerOpen = false"
        />

        <div v-if="settingsOpen" class="dash__modal" @click.self="settingsOpen = false">
            <div class="dash__modal-panel">
                <h2 class="ah-h2">{{ $t('DashV2.dashboard_settings') }}</h2>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('DashV2.name') }}</span>
                    <input v-model="form.title" type="text" class="ah-input" :class="{ 'ah-input--error': formError }" />
                    <span v-if="formError" class="ah-field__error">{{ formError }}</span>
                </label>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('DashV2.visibility') }}</span>
                    <select v-model="form.visibility" class="ah-input">
                        <option value="private">{{ $t('DashV2.vis_private') }}</option>
                        <option value="workspace">{{ $t('DashV2.vis_workspace') }}</option>
                        <option value="project">{{ $t('DashV2.vis_project') }}</option>
                    </select>
                </label>
                <label v-if="form.visibility === 'project'" class="ah-field">
                    <span class="ah-field__label">{{ $t('DashV2.project') }}</span>
                    <select v-model="form.projectId" class="ah-input">
                        <option value="">{{ $t('DashV2.choose_project') }}</option>
                        <option v-for="p in projects" :key="p._id" :value="p._id">{{ p.ProjectName }}</option>
                    </select>
                </label>
                <div class="dash__modal-actions">
                    <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" @click="destroy">{{ $t('DashV2.delete') }}</button>
                    <span class="ah-toolbar__spacer"></span>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="settingsOpen = false">{{ $t('DashV2.cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="saveSettings">{{ $t('DashV2.save') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, provide, onMounted, onBeforeUnmount, inject } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { GridLayout, GridItem } from 'grid-layout-plus';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import DashboardCard from '@/components/organisms/DashboardCard/DashboardCard.vue';
import CardPicker from './CardPicker.vue';
import { catalogEntry, PERIOD_OPTIONS } from '@/plugins/dashboard/cardCatalog';
import { cardComponent } from '@/plugins/dashboard/cardRegistry';
import {
    fetchDashboard, patchDashboard, saveDashboardCards, duplicateDashboard, removeDashboard, makeCardUid,
} from '@/plugins/dashboard/dashboardsApi';

defineOptions({ name: 'DashboardView' });

const route = useRoute();
const router = useRouter();
const { getters } = useStore();
const { t } = useI18n();
const $toast = useToast();

const companyId = inject('$companyId', ref(''));
const clientWidth = inject('$clientWidth', ref(1440));
const wide = computed(() => Number(clientWidth.value) > 768);

const companyUserDetail = computed(() => getters['settings/companyUserDetail']);
const taskStatusArray = computed(() => getters['settings/AllTaskStatus']);
const projects = computed(() => {
    const p = getters['projectData/onlyActiveProjects'];
    return (p && p.data) || [];
});

const dashboard = ref({ title: '', canEdit: false, visibility: 'private', ownerName: '' });
const cards = ref([]);
const hiddenCount = ref(0);
const loading = ref(true);
const loadError = ref('');
const locked = ref(true);
const moving = ref(false);
const menuOpen = ref(false);
const pickerOpen = ref(false);
const settingsOpen = ref(false);
const formError = ref('');
const form = reactive({ title: '', visibility: 'private', projectId: '' });
const refreshKeys = reactive({});

// Cards whose period is "Auto" resolve their window from here.
const weekRange = () => {
    const now = new Date();
    const day = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const start = new Date(now);
    start.setDate(now.getDate() - day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
};
provide('dashboardGlobalRange', ref(weekRange()));

const visibilityLabel = computed(() => t(`DashV2.vis_${dashboard.value.visibility || 'private'}`));
const ownerLine = computed(() => (dashboard.value.isMine
    ? t('DashV2.owned_by_you')
    : t('DashV2.owned_by', { name: dashboard.value.ownerName || t('DashV2.a_teammate') })));

const toLayoutItem = (c) => ({
    ...(c.config && c.config.position ? c.config.position : {}),
    i: c.uid,
    componentId: c.componentId,
    cardData: (c.config && c.config.cardData) || {},
    filterData: (c.config && c.config.filterData) || [],
});
const toCardDoc = (item) => ({
    componentId: item.componentId,
    cardId: '',
    uid: item.i,
    config: {
        cardData: item.cardData || {},
        filterData: item.filterData || [],
        position: {
            x: item.x, y: item.y, w: item.w, h: item.h,
            minW: item.minW, maxW: item.maxW, minH: item.minH, maxH: item.maxH,
        },
    },
});

const componentFor = (item) => cardComponent(item.componentId);
const entryFor = (item) => catalogEntry(item.componentId);
const cardTitle = (item) => (item.cardData && item.cardData.fieldName)
    || (entryFor(item) ? t(entryFor(item).titleKey) : item.componentId);
const cardScope = (item) => (entryFor(item) ? t(entryFor(item).scopeKey) : '');
const periodOptions = (item) => {
    const entry = entryFor(item);
    if (!entry || entry.period === null) return [];
    return PERIOD_OPTIONS.map((o) => ({ id: o.id, label: t(o.labelKey) }));
};
const periodValue = (item) => {
    const v = Number(item.cardData && item.cardData.timerange);
    if (Number.isFinite(v) && v >= 0 && v <= 8) return v;
    const entry = entryFor(item);
    return (entry && entry.period) || 0;
};
const linkLabel = (item) => {
    const entry = entryFor(item);
    return entry && entry.link ? t(entry.link.labelKey) : '';
};
const linkTo = (item) => {
    const entry = entryFor(item);
    if (!entry || !entry.link || !router.hasRoute(entry.link.name)) return null;
    return { name: entry.link.name, params: { cid: companyId.value } };
};
const emptyText = (item) => {
    const entry = entryFor(item);
    return entry && entry.emptyKey ? t(entry.emptyKey) : '';
};
const emptyAction = (item) => {
    const entry = entryFor(item);
    return entry && entry.emptyActionKey && linkTo(item) ? t(entry.emptyActionKey) : '';
};
const goToLink = (item) => {
    const to = linkTo(item);
    if (to) router.push(to);
};

const refresh = (item) => { refreshKeys[item.i] = (refreshKeys[item.i] || 0) + 1; };

const persist = async () => {
    if (!dashboard.value.canEdit) return;
    try {
        await saveDashboardCards(route.params.dashboardId, cards.value.map(toCardDoc));
    } catch (e) {
        $toast.error(t('DashV2.save_failed'), { position: 'top-right' });
    }
};

const onLayoutUpdated = (newLayout) => {
    if (!moving.value) return;
    moving.value = false;
    newLayout.forEach((pos) => {
        const item = cards.value.find((c) => c.i === pos.i);
        if (item) Object.assign(item, { x: pos.x, y: pos.y, w: pos.w, h: pos.h });
    });
    persist();
};

const nextSlot = (w, h) => {
    const bottom = cards.value.reduce((m, c) => Math.max(m, (c.y || 0) + (c.h || 0)), 0);
    return { x: 0, y: bottom, w, h };
};

const addCard = (entry) => {
    const size = entry.size;
    const slot = nextSlot(size.w, size.h);
    cards.value.push({
        ...size,
        ...slot,
        i: makeCardUid(),
        componentId: entry.key,
        cardData: entry.period !== null ? { timerange: entry.period } : {},
        filterData: [],
    });
    pickerOpen.value = false;
    persist();
};

const removeCard = (item) => {
    cards.value = cards.value.filter((c) => c.i !== item.i);
    persist();
};

const setPeriod = (item, value) => {
    item.cardData = { ...(item.cardData || {}), timerange: Number(value) };
    persist();
};

const openSettings = () => {
    menuOpen.value = false;
    form.title = dashboard.value.title;
    form.visibility = dashboard.value.visibility;
    form.projectId = dashboard.value.projectId || '';
    formError.value = '';
    settingsOpen.value = true;
};

const saveSettings = async () => {
    if (!form.title.trim()) {
        formError.value = t('DashV2.name_required');
        return;
    }
    try {
        const updated = await patchDashboard(route.params.dashboardId, {
            title: form.title.trim(),
            visibility: form.visibility,
            projectId: form.projectId,
        });
        dashboard.value = { ...dashboard.value, ...(updated || {}) };
        settingsOpen.value = false;
    } catch (e) {
        formError.value = (e && e.response && e.response.data && e.response.data.message) || t('DashV2.save_failed');
    }
};

const duplicate = async () => {
    menuOpen.value = false;
    try {
        const copy = await duplicateDashboard(route.params.dashboardId);
        if (copy && copy._id) router.push({ name: 'DashboardView', params: { cid: companyId.value, dashboardId: copy._id } });
    } catch (e) {
        $toast.error(t('DashV2.save_failed'), { position: 'top-right' });
    }
};

const destroy = async () => {
    try {
        await removeDashboard(route.params.dashboardId);
        router.push({ name: 'Dashboards', params: { cid: companyId.value } });
    } catch (e) {
        formError.value = t('DashV2.save_failed');
    }
};

const closeMenus = () => { menuOpen.value = false; };

const load = async () => {
    loading.value = true;
    try {
        const doc = await fetchDashboard(route.params.dashboardId);
        dashboard.value = doc || {};
        const all = Array.isArray(doc && doc.cards) ? doc.cards : [];
        const renderable = all.filter((c) => cardComponent(c.componentId));
        hiddenCount.value = all.length - renderable.length;
        cards.value = renderable.map(toLayoutItem);
    } catch (e) {
        loadError.value = (e && e.response && e.response.status === 403)
            ? t('DashV2.no_access')
            : t('DashV2.load_failed');
    } finally {
        loading.value = false;
    }
};

onMounted(() => {
    document.addEventListener('click', closeMenus);
    load();
});
onBeforeUnmount(() => document.removeEventListener('click', closeMenus));
</script>

<style scoped src="./style.css"></style>
