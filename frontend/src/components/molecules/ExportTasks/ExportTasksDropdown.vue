<template>
    <span class="position-re">
        <button class="text-nowrap btn-white border-groupBy border-radius-6-px cursor-pointer" @click.stop="isOpen = !isOpen">
            <strong :style="{color: (clientWidth <= 767 ? '#535358' : '#000')}" :class="{'font-size-12 font-weight-500' : clientWidth > 767 , 'font-size-14 font-weight-400' : clientWidth <=767}">{{ $t('Projects.export_tasks') }}</strong>
        </button>
        <span v-if="isOpen" class="export-tasks__overlay" @click.stop="isOpen = false"></span>
        <div v-if="isOpen" class="export-tasks__panel">
            <div class="cursor-pointer export-tasks__row font-size-13" @click="startExport('csv')">CSV</div>
            <div class="cursor-pointer export-tasks__row font-size-13" @click="startExport('xlsx')">XLSX</div>
        </div>
    </span>
</template>

<script setup>
// PACKAGES
import { defineProps, inject, ref } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// UTILS
import { apiRequest } from '@/services';
import { useGetterFunctions } from "@/composable";

const { t } = useI18n();
const $toast = useToast();
const { getUser } = useGetterFunctions();
const userId = inject('$userId');
const clientWidth = inject('$clientWidth');

const props = defineProps({
    projectData: {
        type: Object,
        required: true
    }
});

const isOpen = ref(false);
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30;

function startExport(format) {
    isOpen.value = false;
    const user = getUser(userId.value);
    apiRequest('post', '/api/v2/exports', {
        format,
        projectId: props.projectData._id,
        projectName: props.projectData.ProjectName,
        userData: { id: user.id, Employee_Name: user.Employee_Name },
    }).then((response) => {
        if (response.data?.status) {
            $toast.info(t('Projects.export_preparing'), { position: 'top-right' });
            pollUntilDone(response.data.data._id, 0);
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in start export: ', error));
}

function pollUntilDone(jobId, attempt) {
    if (attempt >= MAX_POLLS) {
        $toast.error(t('Projects.export_failed'), { position: 'top-right' });
        return;
    }
    setTimeout(() => {
        apiRequest('get', `/api/v2/exports?uid=${encodeURIComponent(userId.value)}`)
        .then((response) => {
            const job = (response.data?.data || []).find((item) => String(item._id) === String(jobId));
            if (!job || job.status === 'queued' || job.status === 'processing') {
                pollUntilDone(jobId, attempt + 1);
            } else if (job.status === 'done') {
                $toast.success(t('Projects.export_ready'), { position: 'top-right' });
                downloadJob(job);
            } else {
                $toast.error(job.error || t('Projects.export_failed'), { position: 'top-right' });
            }
        })
        .catch((error) => console.error('ERROR in poll export: ', error));
    }, POLL_INTERVAL_MS);
}

function downloadJob(job) {
    apiRequest('get', `/api/v2/exports/${job._id}/download?uid=${encodeURIComponent(userId.value)}`, null, null, { responseType: 'blob' })
    .then((response) => {
        const url = URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.download = job.fileName || `tasks.${job.format}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    })
    .catch((error) => console.error('ERROR in download export: ', error));
}
</script>

<style scoped>
.export-tasks__overlay { position: fixed; inset: 0; z-index: 19; }
.export-tasks__panel {
    position: absolute;
    top: 36px;
    right: 0;
    z-index: 20;
    min-width: 120px;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    padding: 4px 0;
}
.export-tasks__row { padding: 7px 14px; }
.export-tasks__row:hover { background: #f7f9fc; }
</style>
