<template>
    <div v-if="modelValue" class="esc__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="esc__card">
            <div class="d-flex align-items-center justify-content-between esc__head">
                <span class="estimation-scale-modal-font-size-16 estimation-scale-modal-font-weight-700">{{ $t('Projects.estimation_scale_title') }}</span>
                <span class="cursor-pointer estimation-scale-modal-font-size-16 esc__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>
            <div class="estimation-scale-modal-font-size-12 estimation-scale-modal-gray81 esc__hint">{{ $t('Projects.estimation_scale_hint') }}</div>
            <select v-model="scale" class="ah-input esc__select">
                <option value="fibonacci">{{ $t('Projects.estimation_scale_fibonacci') }}</option>
                <option value="linear">{{ $t('Projects.estimation_scale_linear') }}</option>
                <option value="tshirt">{{ $t('Projects.estimation_scale_tshirt') }}</option>
                <option value="hours">{{ $t('Projects.estimation_scale_hours') }}</option>
            </select>
            <div class="esc__actions">
                <button type="button" class="ah-btn ah-btn--secondary" @click="$emit('update:modelValue', false)">{{ $t('Projects.cancel') }}</button>
                <button type="button" class="ah-btn ah-btn--primary" :disabled="isSaving" @click="save">{{ isSaving ? $t('Projects.estimation_scale_saving') : $t('Projects.save') }}</button>
            </div>
        </div>
    </div>
</template>

<script>
export default { name: 'EstimationScaleModal' };
</script>

<script setup>
import { ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';

const props = defineProps({
    projectData: { type: Object, required: true },
    modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const store = useStore();
const $toast = useToast();
const { t } = useI18n();
const scale = ref('fibonacci');
const isSaving = ref(false);

watch(() => props.modelValue, (open) => {
    if (open) scale.value = props.projectData?.estimationScale || 'fibonacci';
});

function save() {
    if (isSaving.value) return;
    isSaving.value = true;
    apiRequest('post', '/api/v1/projectSetting/estimationScale', {
        projectId: props.projectData._id,
        scale: scale.value,
    }).then((response) => {
        if (response.data?.status) {
            // Reflect the change in the store so the points picker (which reads
            // project.estimationScale) updates without a reload.
            store.commit('projectData/mutateProjects', [{ op: 'modified', data: { ...props.projectData, estimationScale: scale.value } }]);
            $toast.success(response.data.statusText || t('Projects.estimation_scale_updated'), { position: 'top-right' });
            emit('update:modelValue', false);
        } else {
            $toast.error(response.data?.statusText || t('Projects.estimation_scale_failed'), { position: 'top-right' });
        }
    }).catch((error) => {
        console.error('ERROR in estimation scale save: ', error);
        $toast.error(t('Projects.estimation_scale_failed'), { position: 'top-right' });
    }).finally(() => { isSaving.value = false; });
}
</script>

<style scoped>
.estimation-scale-modal-font-size-12 {
    font-size: 12px;
}
.estimation-scale-modal-font-size-16 {
    font-size: 16px;
}
.estimation-scale-modal-font-weight-700 {
    font-weight: 700 !important;
}
.estimation-scale-modal-gray81 {
    color: var(--ink-2);
}
</style>

<style scoped>
.esc__overlay { position: fixed; inset: 0; background: var(--scrim); z-index: 1000; display: flex; align-items: center; justify-content: center; }
/* The dialog opens inside the project page, which keeps light controls for its legacy views. */
.esc__card { background: var(--surface); color: var(--ink); color-scheme: var(--scheme); border-radius: 10px; width: min(440px, 92vw); padding: 16px 20px; box-shadow: var(--shadow-modal); }
.esc__head { margin-bottom: 8px; }
.esc__close { color: var(--ink-2); }
.esc__close:hover { color: var(--danger); }
.esc__hint { margin-bottom: 12px; }
.esc__actions { display: flex; justify-content: flex-end; gap: var(--sp-4); margin-top: 16px; }
</style>
