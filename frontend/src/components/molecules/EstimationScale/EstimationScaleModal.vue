<template>
    <div v-if="modelValue" class="esc__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="esc__card">
            <div class="d-flex align-items-center justify-content-between esc__head">
                <span class="font-size-16 font-weight-700">Story point scale</span>
                <span class="cursor-pointer font-size-16 esc__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>
            <div class="font-size-12 gray81 esc__hint">Choose the point values the estimation picker offers for this project.</div>
            <select v-model="scale" class="esc__select font-size-13">
                <option value="fibonacci">Fibonacci (1, 2, 3, 5, 8, 13, 21)</option>
                <option value="linear">Linear (1 – 10)</option>
                <option value="tshirt">T-shirt (1, 2, 3, 5, 8)</option>
                <option value="hours">Hours (1, 2, 4, 8, 16, 24, 40)</option>
            </select>
            <div class="d-flex justify-content-end esc__actions">
                <button class="btn_btn esc__ghost-btn font-size-13 mr-10px" @click="$emit('update:modelValue', false)">Cancel</button>
                <button class="btn-primary font-size-13" :disabled="isSaving" @click="save">{{ isSaving ? 'Saving…' : 'Save' }}</button>
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
import { apiRequest } from '@/services';

const props = defineProps({
    projectData: { type: Object, required: true },
    modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const store = useStore();
const $toast = useToast();
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
            $toast.success(response.data.statusText || 'Estimation scale updated', { position: 'top-right' });
            emit('update:modelValue', false);
        } else {
            $toast.error(response.data?.statusText || 'Could not update the scale', { position: 'top-right' });
        }
    }).catch((error) => {
        console.error('ERROR in estimation scale save: ', error);
        $toast.error('Could not update the scale', { position: 'top-right' });
    }).finally(() => { isSaving.value = false; });
}
</script>

<style scoped>
.esc__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.esc__card { background: #fff; border-radius: 10px; width: min(440px, 92vw); padding: 16px 20px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18); }
.esc__head { margin-bottom: 8px; }
.esc__close { color: #9a9a9a; }
.esc__close:hover { color: #e84a4a; }
.esc__hint { margin-bottom: 12px; }
.esc__select { width: 100%; border: 1px solid #e0e0e0; border-radius: 6px; padding: 8px; background: #fff; }
.esc__actions { margin-top: 16px; }
/* .btn_btn forces a navy background !important — keep the Cancel text white. */
.esc__ghost-btn { color: #fff; }
</style>
