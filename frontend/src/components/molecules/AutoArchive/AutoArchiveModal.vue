<template>
    <div v-if="modelValue" class="aarch__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="aarch__card">
            <div class="d-flex align-items-center justify-content-between aarch__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.auto_archive') }}</span>
                <span class="cursor-pointer font-size-16 aarch__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>
            <div class="font-size-12 gray81 aarch__hint">{{ $t('Projects.auto_archive_hint') }}</div>
            <label class="d-flex align-items-center cursor-pointer font-size-13 aarch__row">
                <input type="checkbox" v-model="enabled" />
                <span class="ml-5px">{{ $t('Projects.auto_archive_enable') }}</span>
            </label>
            <div class="d-flex align-items-center font-size-13 aarch__row" :class="{'aarch__row--muted': !enabled}">
                <span class="mr-10px">{{ $t('Projects.auto_archive_after') }}</span>
                <input type="number" min="1" max="365" v-model.number="afterDays" class="aarch__days font-size-13" :disabled="!enabled" />
                <span class="ml-5px">{{ $t('Projects.days') }}</span>
            </div>
            <div class="d-flex justify-content-end">
                <button class="btn-primary font-size-13" :disabled="isSaving" @click="save">{{ $t('Projects.save') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// UTILS
import { apiRequest } from '@/services';

const { t } = useI18n();
const $toast = useToast();

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

const enabled = ref(false);
const afterDays = ref(30);
const isSaving = ref(false);

watch(() => props.modelValue, (open) => {
    if (open) fetchRule();
});

function fetchRule() {
    apiRequest('get', `/api/v1/projectSetting/autoArchive/${props.projectData._id}`)
    .then((response) => {
        if (response.data?.status) {
            enabled.value = response.data.data.enabled === true;
            afterDays.value = response.data.data.afterDays || 30;
        }
    })
    .catch((error) => console.error('ERROR in fetch auto-archive rule: ', error));
}

function save() {
    isSaving.value = true;
    apiRequest('post', '/api/v1/projectSetting/autoArchive', {
        projectId: props.projectData._id,
        enabled: enabled.value,
        afterDays: afterDays.value,
    }).then((response) => {
        if (response.data?.status) {
            $toast.success(response.data.statusText, { position: 'top-right' });
            emit('update:modelValue', false);
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((error) => {
        console.error('ERROR in save auto-archive rule: ', error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }).finally(() => { isSaving.value = false; });
}
</script>

<style scoped>
.aarch__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.aarch__card {
    background: #fff;
    border-radius: 10px;
    width: min(420px, 92vw);
    padding: 16px 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.aarch__head { margin-bottom: 8px; }
.aarch__close { color: #9a9a9a; }
.aarch__close:hover { color: #e84a4a; }
.aarch__hint { margin-bottom: 12px; }
.aarch__row { margin-bottom: 12px; }
.aarch__row--muted { opacity: 0.5; }
.aarch__days {
    width: 70px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 5px 8px;
}
</style>
