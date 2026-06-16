<template>
    <div v-if="modelValue" class="export-tasks__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="export-tasks__card">
            <div class="d-flex align-items-center justify-content-between export-tasks__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.export_tasks') }}</span>
                <span class="cursor-pointer font-size-16 export-tasks__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>
            <div class="font-size-12 gray81 export-tasks__hint">{{ $t('Projects.export_hint') }}</div>
            <div class="d-flex">
                <button class="btn-primary font-size-13 mr-10px" :disabled="isBusy" @click="startExport('csv')">CSV</button>
                <button class="btn-primary font-size-13" :disabled="isBusy" @click="startExport('xlsx')">XLSX</button>
            </div>
        </div>
    </div>
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

const props = defineProps({
    projectData: {
        type: Object,
        required: true
    },
    modelValue: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['update:modelValue']);

const isBusy = ref(false);
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30;

function startExport(format) {
    if (isBusy.value) return;
    isBusy.value = true;
    const user = getUser(userId.value);
    apiRequest('post', '/api/v2/exports', {
        format,
        projectId: props.projectData._id,
        projectName: props.projectData.ProjectName,
        userData: { id: user.id, Employee_Name: user.Employee_Name },
    }).then((response) => {
        if (response.data?.status) {
            $toast.info(t('Projects.export_preparing'), { position: 'top-right' });
            emit('update:modelValue', false);
            pollUntilDone(response.data.data._id, 0);
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in start export: ', error))
    .finally(() => { isBusy.value = false; });
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
.export-tasks__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.export-tasks__card {
    background: #fff;
    border-radius: 10px;
    width: min(360px, 92vw);
    padding: 16px 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.export-tasks__head { margin-bottom: 8px; }
.export-tasks__close { color: #9a9a9a; }
.export-tasks__close:hover { color: #e84a4a; }
.export-tasks__hint { margin-bottom: 14px; }
</style>
