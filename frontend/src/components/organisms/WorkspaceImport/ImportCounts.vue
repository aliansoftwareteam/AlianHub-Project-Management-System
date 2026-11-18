<template>
    <div class="imc">
        <table class="imc__table">
            <caption class="imc__caption">{{ $t(planned ? 'WorkspaceImport.counts_caption_plan' : 'WorkspaceImport.counts_caption_done') }}</caption>
            <thead>
                <tr>
                    <th scope="col">{{ $t('WorkspaceImport.counts_col_kind') }}</th>
                    <th scope="col">{{ $t(planned ? 'WorkspaceImport.counts_col_in_plan' : 'WorkspaceImport.counts_col_in_done') }}</th>
                    <th scope="col">{{ $t('WorkspaceImport.counts_col_out') }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="row in rows" :key="row.key" :data-kind="row.key">
                    <th scope="row">{{ row.label }}</th>
                    <td>{{ row.into }}</td>
                    <td :class="{ imc__out: row.out }">{{ row.out }}</td>
                </tr>
            </tbody>
        </table>
        <ul v-if="notes.length" class="ah-small imc__notes">
            <li v-for="note in notes" :key="note.key" :data-note="note.key">{{ note.text }}</li>
        </ul>
    </div>
</template>

<script setup>
import { computed, defineProps } from "vue";
import { useI18n } from "vue-i18n";
import { countNotes, countRows } from "./importSummary";

defineOptions({ name: "ImportCounts" });

const props = defineProps({
    summary: { type: Object, required: true },
    planned: { type: Boolean, default: false }
});

const { t } = useI18n();
const rows = computed(() => countRows(props.summary, t, "WorkspaceImport"));
const notes = computed(() => countNotes(props.summary, t, "WorkspaceImport", props.planned));
</script>

<style scoped>
.imc { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.imc__table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: var(--text-small, 13px); color: var(--ink); }
.imc__caption { caption-side: top; text-align: left; font-weight: 600; padding: 0 0 4px; color: var(--ink); }
.imc__table th, .imc__table td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--hairline, var(--border)); vertical-align: top; font-weight: 400; overflow-wrap: normal; word-break: normal; }
.imc__table th:first-child { width: 46%; }
.imc__table th:not(:first-child), .imc__table td { width: 27%; }
.imc__table thead th { font-weight: 600; color: var(--ink-2); }
.imc__out { color: var(--warn-ink, var(--ink)); }
.imc__notes { margin: 0; padding-left: 18px; display: grid; gap: 4px; color: var(--ink-2); overflow-wrap: anywhere; }
</style>
