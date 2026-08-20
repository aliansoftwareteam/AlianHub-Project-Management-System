<template>
    <div class="fs">
        <div class="fs__head">
            <div class="fs__headings">
                <h3 class="fs__title">{{ $t('Projects.form_submissions_title') }}</h3>
                <p class="fs__meta">{{ $t('Projects.form_submissions_count', { count: total }) }}</p>
            </div>

            <input v-model="term" class="fs__search" type="search"
                :placeholder="$t('Projects.form_search_submissions')">

            <button type="button" class="fs__btn" :disabled="loading" @click="load()">
                {{ loading ? '…' : $t('Projects.form_refresh') }}
            </button>
            <button type="button" class="fs__btn" :disabled="exporting || !total" @click="exportRows">
                {{ exporting ? '…' : $t('Projects.form_export') }}
            </button>
        </div>

        <div v-if="err" class="fs__err">{{ err }}</div>

        <div v-else-if="!loading && !submissions.length" class="fs__empty">
            {{ term ? $t('Projects.form_no_matches') : $t('Projects.form_no_submissions') }}
        </div>

        <!-- A form can have many questions, so the table scrolls sideways on its
             own rather than widening the page. -->
        <template v-else>
            <div class="fs__scroll">
                <table class="fs__table">
                    <thead>
                        <tr>
                            <th class="fs__when">{{ $t('Projects.form_submitted_at') }}</th>
                            <th v-if="anyTask" class="fs__task">{{ $t('Projects.form_task') }}</th>
                            <th v-for="c in columns" :key="c.id" :class="{ 'is-gone': c.gone }"
                                :title="c.gone ? $t('Projects.form_question_removed') : c.label">
                                {{ c.label }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in submissions" :key="row._id">
                            <td class="fs__when">{{ when(row.submittedAt) }}</td>
                            <td v-if="anyTask" class="fs__task">{{ row.taskKey || '—' }}</td>
                            <td v-for="c in columns" :key="c.id">
                                <span v-if="row.values[c.id]" class="fs__val">{{ row.values[c.id] }}</span>
                                <span v-else class="fs__blank">—</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="pages > 1" class="fs__pager">
                <span class="fs__range">{{ $t('Projects.form_page_of', { page, pages }) }}</span>
                <button type="button" class="fs__page-btn" :disabled="page <= 1 || loading" @click="load(page - 1)">
                    {{ $t('Projects.form_prev_page') }}
                </button>
                <button type="button" class="fs__page-btn" :disabled="page >= pages || loading" @click="load(page + 1)">
                    {{ $t('Projects.form_next_page') }}
                </button>
            </div>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, defineProps } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import { downloadExport } from '@/composable/exportDownload';

const { t } = useI18n();
const props = defineProps({
    formId: { type: String, required: true },
    formTitle: { type: String, default: '' },
});

const PAGE_SIZE = 10;

const columns = ref([]);
const submissions = ref([]);
const total = ref(0);
const page = ref(1);
const pages = ref(1);
const term = ref('');
const loading = ref(false);
const exporting = ref(false);
const err = ref('');

// The task column is pointless on a form that does not create tasks, and on one
// that only started creating them recently it would be mostly dashes.
const anyTask = computed(() => submissions.value.some((s) => s.taskKey));

const when = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const query = (extra) => {
    const parts = [`limit=${PAGE_SIZE}`];
    if (term.value.trim()) parts.push(`q=${encodeURIComponent(term.value.trim())}`);
    return parts.concat(extra || []).join('&');
};

const load = async (toPage) => {
    if (!props.formId) return;
    loading.value = true; err.value = '';
    try {
        const wanted = Math.max(1, Number(toPage) || page.value);
        const body = (await apiRequest('get', `/api/v2/forms/${props.formId}/submissions?${query([`page=${wanted}`])}`))?.data;
        if (body && body.status) {
            columns.value = (body.data && body.data.columns) || [];
            submissions.value = (body.data && body.data.submissions) || [];
            total.value = (body.data && body.data.total) || 0;
            // The server clamps the page to what exists, so a stale page number
            // after a search cannot leave the table blank.
            page.value = (body.data && body.data.page) || 1;
            pages.value = (body.data && body.data.pages) || 1;
        } else {
            err.value = (body && body.statusText) || t('Toast.something_went_wrong');
        }
    } catch (e) {
        err.value = (e && e.response && e.response.data && e.response.data.statusText)
            || (e && e.message) || t('Toast.something_went_wrong');
    } finally { loading.value = false; }
};

// The export is every matching row, not the ten on screen, so it is fetched
// separately before being handed to the shared export endpoint.
const exportRows = async () => {
    if (exporting.value) return;
    exporting.value = true; err.value = '';
    try {
        const body = (await apiRequest('get', `/api/v2/forms/${props.formId}/submissions?${query(['all=1'])}`))?.data;
        if (!body || !body.status) {
            err.value = (body && body.statusText) || t('Toast.something_went_wrong');
            return;
        }
        const cols = (body.data && body.data.columns) || [];
        const rows = (body.data && body.data.submissions) || [];
        // Decided from the rows being exported, not from the page on screen —
        // those can disagree, and the file would then lose the column.
        const withTask = rows.some((r) => r.taskKey);
        const head = [t('Projects.form_submitted_at')]
            .concat(withTask ? [t('Projects.form_task')] : [])
            .concat(cols.map((c) => c.label));
        const table = rows.map((r) => [when(r.submittedAt)]
            .concat(withTask ? [r.taskKey || ''] : [])
            .concat(cols.map((c) => r.values[c.id] || '')));
        await downloadExport('xlsx', {
            filename: `${props.formTitle || 'form'}-submissions`,
            sheetName: 'Submissions',
            tableHead: head,
            tableRows: table,
        });
        if (body.data && body.data.truncated) err.value = t('Projects.form_export_truncated');
    } catch (e) {
        err.value = (e && e.response && e.response.data && e.response.data.statusText)
            || (e && e.message) || t('Toast.something_went_wrong');
    } finally { exporting.value = false; }
};

// Typing is debounced so a search is one request per pause, not per keystroke,
// and always lands back on the first page.
let typing = null;
watch(term, () => {
    if (typing) clearTimeout(typing);
    typing = setTimeout(() => { page.value = 1; load(1); }, 350);
});
onBeforeUnmount(() => { if (typing) clearTimeout(typing); });

onMounted(() => load(1));
watch(() => props.formId, () => { term.value = ''; load(1); });
</script>

<style scoped>
.fs { background: #fff; border: 1px solid #e9eaf2; border-radius: 12px; padding: 18px 20px 22px; }
.fs__head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.fs__headings { flex: 1 1 auto; min-width: 0; }
.fs__title { font-size: 16px; margin: 0; color: #1f2333; }
.fs__meta { font-size: 12px; color: #9aa0b4; margin: 3px 0 0; }
.fs__search { flex: 0 0 240px; border: 1px solid #d7d9e6; border-radius: 7px; padding: 7px 11px;
    font-size: 13px; font-family: inherit; color: #222; background: #fff; }
.fs__search:focus { outline: 2px solid #c9d0f5; outline-offset: 0; border-color: #7b8ce0; }
.fs__btn { flex: 0 0 auto; border: 1px solid #d7d9e6; background: #fff; color: #3b4252;
    border-radius: 7px; padding: 6px 13px; font-size: 13px; cursor: pointer; }
.fs__btn:hover:not(:disabled) { background: #f4f5fb; color: #2f3990; border-color: #b9c0ea; }
.fs__btn:disabled { opacity: .6; cursor: default; }
.fs__err { background: #fdf1f0; color: #a33227; border: 1px solid #f0cfcb; border-radius: 7px;
    padding: 9px 12px; font-size: 13px; }
.fs__empty { color: #9aa0b4; font-size: 14px; padding: 22px 0; text-align: center; }
.fs__scroll { overflow-x: auto; border: 1px solid #eef0f6; border-radius: 9px; }
.fs__table { border-collapse: collapse; width: 100%; font-size: 13px; }
.fs__table th, .fs__table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f2f3f9;
    white-space: nowrap; vertical-align: top; }
.fs__table th { background: #fafbff; color: #6b7280; font-weight: 600; font-size: 12px;
    position: sticky; top: 0; }
.fs__table th.is-gone { font-style: italic; color: #b6bac9; }
.fs__table tbody tr:last-child td { border-bottom: 0; }
.fs__table tbody tr:hover td { background: #fafbff; }
.fs__when, .fs__task { color: #6b7280; font-variant-numeric: tabular-nums; }
.fs__val { display: inline-block; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
    vertical-align: bottom; }
.fs__blank { color: #d3d6e2; }
.fs__pager { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.fs__range { flex: 1 1 auto; font-size: 12px; color: #9aa0b4; font-variant-numeric: tabular-nums; }
.fs__page-btn { border: 1px solid #d7d9e6; background: #fff; color: #3b4252; border-radius: 7px;
    padding: 5px 12px; font-size: 13px; cursor: pointer; }
.fs__page-btn:hover:not(:disabled) { background: #f4f5fb; color: #2f3990; border-color: #b9c0ea; }
.fs__page-btn:disabled { opacity: .5; cursor: default; }
@media (max-width: 820px) {
    .fs__head { flex-wrap: wrap; }
    .fs__search { flex: 1 1 100%; order: 3; }
}
</style>
