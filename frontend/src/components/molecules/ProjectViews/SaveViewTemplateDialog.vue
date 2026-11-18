<template>
    <teleport to="body">
        <div class="svt-layer">
            <div class="svt-backdrop" aria-hidden="true" @click="$emit('close')"></div>
            <form
                ref="dialogEl"
                class="svt"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="headingId"
                :aria-describedby="hintId"
                tabindex="-1"
                data-view-template-dialog
                @submit.prevent="save"
                @keydown.esc.stop.prevent="$emit('close')"
            >
                <h2 :id="headingId" class="svt__heading">{{ $t('ViewTemplates.save_title') }}</h2>
                <label class="svt__field">
                    <span class="svt__label">{{ $t('ViewTemplates.name') }}</span>
                    <input
                        ref="nameEl"
                        v-model="name"
                        type="text"
                        class="ah-input svt__input"
                        data-view-template-name
                        :maxlength="NAME_LIMIT"
                    >
                </label>
                <p :id="hintId" class="svt__hint">{{ $t('ViewTemplates.save_hint') }}</p>
                <p v-if="error" class="svt__error" role="alert">{{ error }}</p>
                <div class="svt__foot">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('close')">{{ $t('ViewTemplates.cancel') }}</button>
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-action="save" :disabled="busy">
                        {{ busy ? $t('ViewTemplates.saving') : $t('ViewTemplates.save') }}
                    </button>
                </div>
            </form>
        </div>
    </teleport>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { useFocusTrap } from '@/composable/useFocusTrap';
import { viewKeyOf } from '@/views/Projects/composables/savedViewSettings';
import { NAME_LIMIT, errorText, saveViewTemplate } from './viewTemplates';

defineOptions({ name: 'SaveViewTemplateDialog' });

const props = defineProps({
    view: { type: Object, required: true },
    viewName: { type: String, default: '' },
    projectId: { type: String, default: '' },
});
const emit = defineEmits(['close']);

const { t } = useI18n();
const toast = useToast();

const uid = `svt-${Math.random().toString(36).slice(2, 8)}`;
const headingId = `${uid}-heading`;
const hintId = `${uid}-hint`;

const dialogEl = ref(null);
const nameEl = ref(null);
const name = ref(props.viewName.slice(0, NAME_LIMIT));
const busy = ref(false);
const error = ref('');

useFocusTrap(dialogEl, ref(true));

onMounted(() => {
    nameEl.value?.focus();
    nameEl.value?.select();
});

async function save() {
    const title = name.value.trim();
    if (busy.value) return;
    if (!title) {
        error.value = t('ViewTemplates.name_required');
        nameEl.value?.focus();
        return;
    }
    busy.value = true;
    error.value = '';
    try {
        await saveViewTemplate({ projectId: props.projectId, viewId: viewKeyOf(props.view), name: title });
        toast.success(t('ViewTemplates.saved', { name: title }), { position: 'top-right' });
        emit('close');
    } catch (e) {
        error.value = errorText(e, t('ViewTemplates.save_failed'));
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.svt-layer {
    position: fixed;
    inset: 0;
    z-index: 1000;
}
.svt-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, .36);
}
.svt {
    position: absolute;
    top: 14vh;
    left: 50%;
    transform: translateX(-50%);
    box-sizing: border-box;
    width: 420px;
    max-width: calc(100vw - 32px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 16px;
    border-radius: var(--r-modal);
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-modal);
    font: var(--text-body);
    white-space: normal;
}
.svt:focus {
    outline: none;
}
.svt__heading {
    margin: 0;
    font: 600 14px/1.3 var(--font-ui);
    color: var(--ink);
}
.svt__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
}
.svt__label {
    font: 500 12px/1.2 var(--font-ui);
    color: var(--ink-label);
}
.ah-input.svt__input {
    height: 34px;
}
.svt__hint {
    margin: 0;
    color: var(--ink-2);
    font: var(--text-small);
}
.svt__error {
    margin: 0;
    color: var(--danger);
    font: var(--text-small);
}
.svt__foot {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--hairline);
}
@media (max-width: 767px) {
    .svt {
        top: 8dvh;
    }
}
</style>
