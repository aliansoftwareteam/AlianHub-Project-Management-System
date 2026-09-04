<template>
    <teleport to="body">
        <div v-if="modelValue" class="imd__overlay" @click.self="close()">
            <div class="imd__card" role="dialog" aria-modal="true" :aria-label="$t('Projects.import_title')">
                <div class="imd__head">
                    <div>
                        <h2 class="ah-h2 imd__title">{{ $t('Projects.import_title') }}</h2>
                        <p class="ah-muted ah-small imd__lead">{{ $t('Projects.import_lead') }}</p>
                    </div>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Projects.close')" @click="close()">
                        <ShellIcon name="x" :size="16" />
                    </button>
                </div>
                <div class="imd__grid">
                    <button v-for="source in SOURCES" :key="source.key" type="button" class="ah-card imd__source" @click="pick(source.key)">
                        <span class="imd__mark" :style="{ background: source.tint }">{{ source.mark }}</span>
                        <span class="imd__text">
                            <strong>{{ $t(`Projects.import_${source.key}_title`) }}</strong>
                            <span class="ah-small ah-muted">{{ $t(`Projects.import_${source.key}_desc`) }}</span>
                        </span>
                        <ShellIcon name="chevronRight" :size="14" class="imd__chev" />
                    </button>
                </div>
            </div>
        </div>
    </teleport>

    <ImportWizard
        :showImportModal="open.csv"
        :projectId="String(projectData?._id || '')"
        :taskStatus="projectData?.taskStatusData || []"
        :users="projectData?.isPrivateSpace ? (projectData?.AssigneeUserId || []) : users"
        :sprint="sprint"
        @toggle-import-modal="open.csv = $event"
    />
    <ImportJiraModal v-model="open.jira" :projectData="projectData" />
    <ImportTrelloModal v-model="open.trello" :projectData="projectData" />
    <ImportAsanaModal v-model="open.asana" :projectData="projectData" />
    <ImportMondayModal v-model="open.monday" :projectData="projectData" />
</template>

<script setup>
import { reactive, defineProps, defineEmits } from 'vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import ImportWizard from '@/plugins/importTasks/components/organisms/ImportWizard/ImportWizard.vue';
import ImportJiraModal from '@/components/molecules/ImportJira/ImportJiraModal.vue';
import ImportTrelloModal from '@/components/molecules/ImportTrello/ImportTrelloModal.vue';
import ImportAsanaModal from '@/components/molecules/ImportAsana/ImportAsanaModal.vue';
import ImportMondayModal from '@/components/molecules/ImportMonday/ImportMondayModal.vue';

defineProps({
    modelValue: { type: Boolean, default: false },
    projectData: { type: Object, required: true },
    users: { type: Array, default: () => [] },
    sprint: { type: Object, default: () => ({}) }
});
const emit = defineEmits(['update:modelValue']);

const SOURCES = [
    { key: 'csv', mark: 'CSV', tint: '#2f9e7e' },
    { key: 'jira', mark: 'J', tint: '#0052cc' },
    { key: 'trello', mark: 'T', tint: '#0079bf' },
    { key: 'asana', mark: 'A', tint: '#f06a6a' },
    { key: 'monday', mark: 'M', tint: '#6161ff' }
];

const open = reactive({ csv: false, jira: false, trello: false, asana: false, monday: false });

const close = () => emit('update:modelValue', false);
const pick = (key) => {
    close();
    open[key] = true;
};
</script>

<style scoped>
.imd__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.imd__card { background: var(--surface); color: var(--ink); border-radius: 12px; width: min(520px, 100%); padding: 20px; box-shadow: var(--shadow-pop); font-family: var(--font-ui); }
.imd__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.imd__title { margin: 0 0 4px; }
.imd__lead { margin: 0; }
.imd__grid { display: grid; gap: 8px; }
.imd__source { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; text-align: left; cursor: pointer; color: var(--ink); }
.imd__source:hover { border-color: var(--brand); }
.imd__mark { flex: none; width: 34px; height: 34px; border-radius: 8px; color: #fff; display: flex; align-items: center; justify-content: center; font: 700 11px/1 var(--font-ui); }
.imd__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.imd__chev { color: var(--ink-3); flex: none; }
</style>
