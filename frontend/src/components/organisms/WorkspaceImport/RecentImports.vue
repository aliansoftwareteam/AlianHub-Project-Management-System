<template>
    <section v-if="jobs.length || failed" class="rim" aria-labelledby="rim-title">
        <h3 id="rim-title" class="ah-small rim__title">{{ $t('WorkspaceImport.recent_title') }}</h3>
        <p v-if="failed" class="ah-small ah-muted" role="alert">{{ $t('WorkspaceImport.recent_failed') }}</p>
        <ul class="rim__jobs">
            <li v-for="job in jobs" :key="job._id" class="rim__job" :data-status="job.status" data-test="rim-job">
                <span class="rim__main">
                    <strong>{{ sourceName(job) }}</strong>
                    <span class="ah-small ah-muted">{{ startedAt(job) }}</span>
                    <span class="ah-small ah-muted">{{ $t('WorkspaceImport.recent_counts', { created: job.created || 0, updated: job.updated || 0 }) }}</span>
                </span>
                <span v-if="job.status !== 'done'" class="ah-chip" data-test="rim-status">{{ $t(`WorkspaceImport.recent_status_${statusKey(job)}`) }}</span>
                <ImportUndo v-else-if="job.created" :job-ids="[job._id]" :count="job.created" @undone="markUndone(job)" />
            </li>
        </ul>
    </section>
</template>

<script setup>
import { defineProps, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { fullText } from "@/utils/clockText";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ImportUndo from "./ImportUndo.vue";
import { IMPORT_SOURCES } from "./workspaceImportState";

defineOptions({ name: "RecentImports" });

const props = defineProps({
    projectId: { type: String, default: "" }
});
const { t } = useI18n();

const KNOWN_STATUSES = ["undone", "failed", "processing"];
const jobs = ref([]);
const failed = ref(false);

const sourceName = (job) => (IMPORT_SOURCES.some((source) => source.key === job.source) ? t(`Projects.import_${job.source}_title`) : job.source);
const startedAt = (job) => fullText(job.createdAt);
const statusKey = (job) => (KNOWN_STATUSES.includes(job.status) ? job.status : "processing");
const markUndone = (job) => { job.status = "undone"; };

onMounted(async () => {
    try {
        const { data } = await apiRequest("get", props.projectId ? `${env.IMPORTS}?projectId=${encodeURIComponent(props.projectId)}` : env.IMPORTS);
        if (!data?.status) throw new Error(data?.statusText || "");
        jobs.value = data.data || [];
    } catch (error) {
        failed.value = true;
    }
});
</script>

<style scoped>
.rim { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.rim__title { margin: 0; font-weight: 600; color: var(--ink); }
.rim__jobs { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.rim__job { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 8px 0; border-top: 1px solid var(--hairline, var(--border)); }
.rim__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; color: var(--ink); overflow-wrap: anywhere; }
</style>
