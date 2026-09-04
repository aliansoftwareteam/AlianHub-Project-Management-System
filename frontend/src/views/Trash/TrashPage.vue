<template>
    <div class="ah-page tr">
        <header class="tr__head">
            <div>
                <h1 class="ah-h1 tr__title"><ShellIcon name="trash" :size="18" />{{ $t('TrashV2.title') }}</h1>
                <p class="ah-muted ah-small tr__lead">{{ $t('TrashV2.lead') }}</p>
            </div>
        </header>

        <div class="ah-tabs tr__tabs" role="tablist">
            <button
                v-for="k in KINDS"
                :key="k"
                type="button"
                class="ah-tab"
                :class="{ 'is-active': kind === k }"
                role="tab"
                :aria-selected="kind === k"
                @click="kind = k"
            >{{ $t(`TrashV2.${k}`) }}</button>
        </div>

        <p v-if="loading" class="ah-small ah-muted tr__loading">{{ $t('TrashV2.loading') }}</p>

        <EmptyState
            v-else-if="!rows.length"
            :title="$t('TrashV2.empty_title')"
            :message="$t('TrashV2.empty_message', { kind: $t(`TrashV2.empty_${kind}`) })"
        />

        <div v-else class="ah-card tr__list">
            <div class="tr__cols ah-label">
                <span></span>
                <span>{{ $t('TrashV2.col_name') }}</span>
                <span class="tr__c-project">{{ $t('TrashV2.col_project') }}</span>
                <span class="tr__c-when">{{ $t('TrashV2.col_when') }}</span>
                <span></span>
            </div>
            <div v-for="row in rows" :key="row._id" class="tr__row">
                <ShellIcon :name="ICONS[kind]" :size="14" class="tr__row-icon" />
                <span class="tr__row-title" :title="row.title">
                    <span v-if="row.code" class="ah-chip ah-chip--mono">{{ row.code }}</span>
                    {{ row.title }}
                </span>
                <span class="tr__row-project tr__c-project">{{ projectNameOf(row.projectId) }}</span>
                <span class="tr__row-time tr__c-when">{{ shortDate(row.updatedAt) }}</span>
                <button type="button" class="ah-btn ah-btn--sm ah-btn--secondary" :disabled="busy === row._id" @click="restore(row)">
                    <ShellIcon name="restore" :size="13" />{{ $t('TrashV2.restore') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, inject, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import { useGetterFunctions } from '@/composable';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import EmptyState from '@/components/atom/EmptyState/EmptyState.vue';

const KINDS = ['projects', 'lists', 'tasks', 'docs'];
const ICONS = { projects: 'projects', lists: 'layout', tasks: 'checkSquare', docs: 'file' };

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const userId = inject('$userId');

const kind = ref('projects');
const rows = ref([]);
const loading = ref(false);
const busy = ref('');

const projects = computed(() => getters['projectData/allProjects']?.data || []);
const projectNameOf = (id) => {
    if (!id) return t('TrashV2.unknown_project');
    const project = projects.value.find((p) => String(p._id) === String(id));
    return project?.ProjectName || (kind.value === 'projects' ? '' : t('TrashV2.unknown_project'));
};

const shortDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

async function load() {
    loading.value = true;
    try {
        const response = await apiRequest('get', `/api/v2/trash?kind=${kind.value}`);
        rows.value = response.data?.status ? (response.data.data || []) : [];
    } catch (error) {
        console.error('ERROR in load trash: ', error);
        $toast.error(t('TrashV2.load_failed'), { position: 'top-right' });
        rows.value = [];
    } finally {
        loading.value = false;
    }
}

async function restore(row) {
    if (busy.value) return;
    busy.value = row._id;
    try {
        const me = getUser(userId.value) || {};
        const response = await apiRequest('put', `/api/v2/trash/${row.kind}/${row._id}/restore`, {
            userData: { id: me.id || String(userId.value || ''), Employee_Name: me.Employee_Name || '' }
        });
        if (!response.data?.status) throw new Error(response.data?.statusText || 'restore failed');
        rows.value = rows.value.filter((r) => r._id !== row._id);
        $toast.success(t('TrashV2.restored'), { position: 'top-right' });
    } catch (error) {
        console.error('ERROR in restore: ', error);
        $toast.error(t('TrashV2.restore_failed'), { position: 'top-right' });
    } finally {
        busy.value = '';
    }
}

watch(kind, load);
onMounted(load);
</script>

<style scoped>
.tr { padding: 20px 24px; font-family: var(--font-ui); max-width: 1040px; }
.tr__head { margin-bottom: 14px; }
.tr__title { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; }
.tr__lead { margin: 0; }
.tr__tabs { margin-bottom: 14px; }
.tr__loading { padding: 12px 0; }
.tr__list { display: flex; flex-direction: column; overflow: hidden; }
.tr__cols, .tr__row {
    display: grid; grid-template-columns: 20px minmax(0, 1fr) 180px 72px auto;
    align-items: center; gap: 10px; padding: 9px 14px;
}
.tr__cols { border-bottom: 1px solid var(--hairline); }
.tr__row { border-bottom: 1px solid var(--hairline); font: 400 12.5px var(--font-ui); color: var(--ink); transition: background var(--t-state) var(--ease); }
.tr__row:last-child { border-bottom: 0; }
.tr__row:hover { background: var(--surface-hover); }
.tr__row-icon { color: var(--ink-3); }
.tr__row-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.tr__row-project { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tr__row-time { font: 500 10.5px var(--font-mono); color: var(--ink-3); }
@media (max-width: 767px) {
    .tr { padding: 14px 12px; }
    .tr__cols, .tr__row { grid-template-columns: 20px minmax(0, 1fr) auto; }
    .tr__c-project, .tr__c-when { display: none; }
}
</style>
