<template>
    <div class="iex">
        <p v-if="!allowed" class="ah-empty" data-test="iex-denied">{{ $t('ImportExport.owners_only') }}</p>
        <template v-else>
            <section class="ah-card iex__section" aria-labelledby="iex-import-title">
                <h2 id="iex-import-title" class="ah-h3 iex__title">{{ $t('ImportExport.import_title') }}</h2>
                <p class="ah-small ah-muted iex__lead">{{ $t('ImportExport.import_lead') }}</p>
                <div>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="iex-import" @click="showImport = true">{{ $t('ImportExport.import_start') }}</button>
                </div>
                <RecentImports :key="importsShown" />
            </section>

            <section class="ah-card iex__section" aria-labelledby="iex-export-title">
                <h2 id="iex-export-title" class="ah-h3 iex__title">{{ $t('ImportExport.export_title') }}</h2>
                <p class="ah-small ah-muted iex__lead">{{ $t('ImportExport.export_lead') }}</p>
                <div class="iex__row">
                    <label class="ah-small iex__label" for="iex-format">{{ $t('ImportExport.format_label') }}</label>
                    <select id="iex-format" v-model="format" class="iex__select">
                        <option value="xlsx">{{ $t('ImportExport.format_xlsx') }}</option>
                        <option value="csv">{{ $t('ImportExport.format_csv') }}</option>
                    </select>
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="starting || hasRunning" data-test="iex-export" @click="startExport">{{ $t('ImportExport.export_start') }}</button>
                </div>
                <p v-if="error" class="ah-small iex__error" role="alert">{{ error }}</p>

                <p v-if="!jobs.length" class="ah-small ah-muted" data-test="iex-none">{{ $t('ImportExport.no_exports') }}</p>
                <ul v-else class="iex__jobs" aria-live="polite">
                    <li v-for="job in jobs" :key="job._id" class="iex__job" :data-status="job.status">
                        <span class="iex__job-main">
                            <strong class="iex__file">{{ job.fileName }}</strong>
                            <span class="ah-small ah-muted">{{ startedAt(job) }}</span>
                        </span>
                        <span class="ah-chip iex__status" :class="`iex__status--${job.status}`">{{ $t(`ImportExport.status_${job.status}`) }}</span>
                        <span v-if="job.status === 'done'" class="ah-small ah-muted">{{ $t('ImportExport.rows', { count: job.total || 0 }) }}</span>
                        <span v-if="job.status === 'failed' && job.error" class="ah-small iex__error">{{ job.error }}</span>
                        <button v-if="job.status === 'done'" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="iex-download" :aria-label="$t('ImportExport.download_named', { name: job.fileName })" @click="download(job)">
                            <ShellIcon name="download" :size="14" />{{ $t('ImportExport.download') }}
                        </button>
                    </li>
                </ul>
            </section>
        </template>

        <WorkspaceImportDialog v-if="showImport" @close="closeImport" @imported="markImported" />
    </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { fullText } from "@/utils/clockText";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { isOwnerOrAdmin } from "@/utils/roles";
import { saveOnboarding } from "@/composable/onboardingState";
import RecentImports from "@/components/organisms/WorkspaceImport/RecentImports.vue";

defineOptions({ name: "ImportExport" });

const WorkspaceImportDialog = defineAsyncComponent(() => import("@/components/organisms/WorkspaceImport/WorkspaceImportDialog.vue"));

const POLL_MS = 3000;

const { getters } = useStore();
const { t } = useI18n();

const allowed = computed(() => isOwnerOrAdmin((getters["settings/companyUserDetail"] || {}).roleType));
const showImport = ref(false);
const importsShown = ref(0);
// The list of recent imports is read again once the dialog closes, so an import just made is in it.
const closeImport = () => {
    showImport.value = false;
    importsShown.value += 1;
};
const format = ref("xlsx");
const starting = ref(false);
const error = ref("");
const jobs = ref([]);
let timer = null;

const hasRunning = computed(() => jobs.value.some((job) => job.status === "queued" || job.status === "processing"));
const startedAt = (job) => fullText(job.createdAt);
const markImported = () => saveOnboarding({ importedWork: true });

async function loadJobs() {
    try {
        const { data } = await apiRequest("get", env.EXPORTS);
        if (data?.status) jobs.value = (data.data || []).filter((job) => job.type === "workspace");
    } catch (loadError) {
        error.value = t("ImportExport.load_failed");
    }
    schedule();
}

function schedule() {
    clearTimeout(timer);
    timer = hasRunning.value ? setTimeout(loadJobs, POLL_MS) : null;
}

async function startExport() {
    if (starting.value) return;
    starting.value = true;
    error.value = "";
    try {
        const { data } = await apiRequest("post", env.EXPORTS_WORKSPACE, { format: format.value });
        if (!data?.status) throw new Error(data?.statusText || "");
        jobs.value = [data.data, ...jobs.value.filter((job) => job._id !== data.data._id)];
        schedule();
    } catch (startError) {
        error.value = startError?.response?.data?.statusText || startError?.message || t("ImportExport.start_failed");
    } finally {
        starting.value = false;
    }
}

async function download(job) {
    try {
        const response = await apiRequest("get", `${env.EXPORTS}/${job._id}/download`, null, null, { responseType: "blob" });
        const url = URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement("a");
        link.href = url;
        link.download = job.fileName || `workspace.${job.format}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (downloadError) {
        error.value = t("ImportExport.download_failed");
    }
}

onMounted(() => { if (allowed.value) loadJobs(); });
watch(allowed, (now, before) => { if (now && !before) loadJobs(); });
onBeforeUnmount(() => clearTimeout(timer));
</script>

<style scoped>
.iex { display: flex; flex-direction: column; gap: 16px; padding: 16px; max-width: 760px; }
.iex__section { display: flex; flex-direction: column; gap: 10px; padding: 16px; background: var(--surface); color: var(--ink); }
.iex__title { margin: 0; }
.iex__lead { margin: 0; }
.iex__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.iex__label { font-weight: 600; }
.iex__select { border: 1px solid var(--border); border-radius: var(--r-input, 6px); padding: 6px 8px; background: var(--surface); color: var(--ink); }
.iex__error { color: var(--danger-ink, var(--danger)); margin: 0; }
.iex__jobs { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.iex__job { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid var(--hairline, var(--border)); }
.iex__job-main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 200px; }
.iex__file { overflow-wrap: anywhere; font-size: var(--text-small, 13px); }
.iex__status--done { background: var(--ok-bg); color: var(--ok-ink); }
.iex__status--failed { background: var(--danger-bg); color: var(--danger-ink); }
.iex__status--queued, .iex__status--processing { background: var(--warn-bg); color: var(--warn-ink); }
@media (max-width: 480px) {
    .iex { padding: 12px 0; }
}
</style>
