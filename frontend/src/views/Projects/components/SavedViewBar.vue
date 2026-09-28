<template>
    <div class="svb" role="region" :aria-label="$t('SavedViews.region')">
        <span class="svb__status" role="status" aria-live="polite">
            <span class="svb__dot" aria-hidden="true"></span>
            <span>{{ saving ? $t('SavedViews.saving') : $t('SavedViews.unsaved') }}</span>
        </span>
        <form v-if="naming" class="svb__form" @submit.prevent="submitNew" @keydown.esc.stop.prevent="closeNaming">
            <input
                ref="nameInput"
                v-model="newTitle"
                type="text"
                class="svb__input"
                maxlength="60"
                :aria-label="$t('SavedViews.new_name')"
                :placeholder="$t('SavedViews.new_name_placeholder')"
            >
            <label class="svb__check">
                <input v-model="onlyMe" type="checkbox" :disabled="!canSaveShared">
                <span>{{ $t('SavedViews.only_me') }}</span>
            </label>
            <button type="submit" class="svb__btn svb__btn--primary" :disabled="saving || !newTitle.trim()">{{ $t('SavedViews.create') }}</button>
            <button type="button" class="svb__btn" @click="closeNaming">{{ $t('SavedViews.cancel') }}</button>
        </form>
        <div v-else class="svb__actions">
            <button v-if="isPrivate || canSaveShared" type="button" class="svb__btn svb__btn--primary" data-action="save" :disabled="saving" :title="isPrivate ? $t('SavedViews.save_private_hint') : $t('SavedViews.save_hint')" @click="$emit('save')">{{ $t('SavedViews.save') }}</button>
            <button v-if="!isPrivate" type="button" class="svb__btn" data-action="save-for-me" :disabled="saving" :title="$t('SavedViews.save_for_me_hint')" @click="$emit('saveForMe')">{{ $t('SavedViews.save_for_me') }}</button>
            <button ref="saveAsNewButton" type="button" class="svb__btn" data-action="save-as-new" :disabled="saving" @click="openNaming">{{ $t('SavedViews.save_as_new') }}</button>
            <button type="button" class="svb__btn svb__btn--quiet" data-action="reset" :disabled="saving" :title="$t('SavedViews.reset_hint')" @click="$emit('reset')">{{ $t('SavedViews.reset') }}</button>
        </div>
    </div>
</template>

<script setup>
import { nextTick, ref } from 'vue';

const props = defineProps({
    canSaveShared: { type: Boolean, default: false },
    isPrivate: { type: Boolean, default: false },
    saving: { type: Boolean, default: false },
});
const emit = defineEmits(['save', 'saveForMe', 'saveAsNew', 'reset']);

const naming = ref(false);
const newTitle = ref('');
const onlyMe = ref(false);
const nameInput = ref(null);
const saveAsNewButton = ref(null);

async function openNaming() {
    newTitle.value = '';
    onlyMe.value = !props.canSaveShared;
    naming.value = true;
    await nextTick();
    nameInput.value?.focus();
}

async function closeNaming() {
    naming.value = false;
    await nextTick();
    saveAsNewButton.value?.focus();
}

function submitNew() {
    const title = newTitle.value.trim();
    if (!title) return;
    emit('saveAsNew', { title, isPrivate: onlyMe.value || !props.canSaveShared });
    naming.value = false;
}
</script>

<style scoped>
.svb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 6px 20px;
    background: var(--warn-bg);
    border-bottom: 1px solid var(--hairline);
    color: var(--warn-ink);
    font: var(--text-small);
}
.svb__status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
}
.svb__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warn);
    flex: none;
}
.svb__actions,
.svb__form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
.svb__btn {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--hairline);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    font: 500 12.5px/1 var(--font-ui);
    cursor: pointer;
    white-space: nowrap;
}
.svb__btn:hover:not(:disabled) {
    background: var(--surface-hover);
}
.svb__btn--primary {
    border-color: var(--brand);
    background: var(--brand);
    color: var(--on-brand);
}
.svb__btn--primary:hover:not(:disabled) {
    background: var(--brand-deep);
}
.svb__btn--quiet {
    border-color: transparent;
    background: transparent;
    color: var(--warn-ink);
}
.svb__btn:disabled {
    opacity: 0.6;
    cursor: default;
}
.svb__btn:focus-visible,
.svb__input:focus-visible,
.svb__check input:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
}
.svb__input {
    height: 28px;
    width: 200px;
    max-width: 100%;
    padding: 0 8px;
    border: 1px solid var(--hairline);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    font: var(--text-small);
}
.svb__check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    color: var(--ink);
}
@media (max-width: 767px) {
    .svb {
        padding: 6px 12px;
    }
    .svb__form,
    .svb__actions {
        width: 100%;
    }
    .svb__input {
        flex: 1 1 140px;
        width: auto;
    }
}
</style>
