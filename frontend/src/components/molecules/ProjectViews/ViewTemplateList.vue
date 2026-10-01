<template>
    <section ref="root" class="view__group vtl" data-view-templates>
        <h3 class="view__group-title">{{ $t('ViewTemplates.from_template') }}</h3>
        <ul class="vtl__list">
            <li v-for="template in shown" :key="template._id" class="vtl__row">
                <form
                    v-if="renamingId === template._id"
                    class="vtl__form"
                    data-template-form
                    @submit.prevent="saveRename(template)"
                    @keydown.esc.stop.prevent="renamingId = ''"
                >
                    <input
                        v-model="renameValue"
                        type="text"
                        class="ah-input vtl__input"
                        data-template-name
                        :maxlength="NAME_LIMIT"
                        :aria-label="$t('ViewTemplates.rename_label', { name: template.name })"
                    >
                    <button type="submit" class="vtl__link" :disabled="busy">{{ $t('ViewTemplates.save') }}</button>
                    <button type="button" class="vtl__link" @click="renamingId = ''">{{ $t('ViewTemplates.cancel') }}</button>
                </form>
                <template v-else>
                    <button
                        type="button"
                        class="view__cell vtl__pick"
                        :data-template-pick="template._id"
                        :disabled="adding"
                        @click="$emit('pick', template)"
                    >
                        <span v-if="projectComponentsIcons(template.viewType)?.icon" class="ah-mask-icon view__cell-icon" :style="maskOf(projectComponentsIcons(template.viewType).icon)" aria-hidden="true"></span>
                        <span class="view__cell-name">{{ template.name }}</span>
                        <span class="view__cell-tag">{{ $t(`ViewList.${template.viewName}`) }}</span>
                    </button>
                    <template v-if="template.canManage">
                        <template v-if="deletingId === template._id">
                            <button type="button" class="vtl__link vtl__link--danger" data-template-confirm-delete :disabled="busy" @click="remove(template)">{{ $t('ViewTemplates.delete_confirm') }}</button>
                            <button type="button" class="vtl__link" @click="deletingId = ''">{{ $t('ViewTemplates.cancel') }}</button>
                        </template>
                        <template v-else>
                            <button
                                type="button"
                                class="vtl__link"
                                :data-template-rename="template._id"
                                :aria-label="$t('ViewTemplates.rename_label', { name: template.name })"
                                @click="startRename(template)"
                            >{{ $t('ViewTemplates.rename') }}</button>
                            <button
                                type="button"
                                class="vtl__link vtl__link--danger"
                                :data-template-delete="template._id"
                                :aria-label="$t('ViewTemplates.delete_label', { name: template.name })"
                                @click="deletingId = template._id"
                            >{{ $t('ViewTemplates.delete') }}</button>
                        </template>
                    </template>
                </template>
            </li>
        </ul>
        <button
            v-if="foldable"
            type="button"
            class="vtl__link vtl__more"
            data-template-more
            :aria-expanded="expanded ? 'true' : 'false'"
            @click="expanded = !expanded"
        >{{ expanded ? $t('ViewTemplates.show_fewer') : $t('ViewTemplates.show_all', { n: templates.length }) }}</button>
        <p v-if="error" class="vtl__error" role="alert">{{ error }}</p>
    </section>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { projectComponentsIcons } from '@/composable/commonFunction';
import { maskOf } from '@/utils/iconMask';
import { NAME_LIMIT, deleteViewTemplate, errorText, renameViewTemplate } from './viewTemplates';

defineOptions({ name: 'ViewTemplateList' });

/* The list sits above the built-in kinds of view, so a long one is folded to keep those in sight. */
const FOLDED_COUNT = 4;

const props = defineProps({
    templates: { type: Array, default: () => [] },
    adding: { type: Boolean, default: false },
    showAll: { type: Boolean, default: false },
});
const emit = defineEmits(['pick', 'changed']);

const { t } = useI18n();

const expanded = ref(false);
const foldable = computed(() => !props.showAll && props.templates.length > FOLDED_COUNT);
const shown = computed(() => (foldable.value && !expanded.value ? props.templates.slice(0, FOLDED_COUNT) : props.templates));

const root = ref(null);
const renamingId = ref('');
const renameValue = ref('');
const deletingId = ref('');
const busy = ref(false);
const error = ref('');

async function startRename(template) {
    error.value = '';
    deletingId.value = '';
    renameValue.value = template.name;
    renamingId.value = template._id;
    await nextTick();
    root.value?.querySelector('[data-template-name]')?.focus();
}

async function change(task, fallback) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
        await task();
        emit('changed');
    } catch (e) {
        error.value = errorText(e, t(fallback));
    } finally {
        busy.value = false;
        renamingId.value = '';
        deletingId.value = '';
    }
}

function saveRename(template) {
    const name = renameValue.value.trim();
    if (!name || name === template.name) {
        renamingId.value = '';
        return undefined;
    }
    return change(() => renameViewTemplate(template._id, name), 'ViewTemplates.rename_failed');
}

const remove = (template) => change(() => deleteViewTemplate(template._id), 'ViewTemplates.delete_failed');
</script>

<style scoped>
.vtl__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
}
.vtl__row,
.vtl__form {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}
.vtl__form {
    flex: 1 1 auto;
    flex-wrap: wrap;
}
.vtl__pick {
    flex: 1 1 auto;
}
.ah-input.vtl__input {
    flex: 1 1 140px;
    width: auto;
    min-width: 0;
    height: 32px;
}
.vtl__link {
    flex: 0 0 auto;
    padding: 4px 6px;
    border: 0;
    border-radius: var(--r-input);
    background: transparent;
    color: var(--brand);
    font: var(--text-small);
    cursor: pointer;
}
.vtl__link:hover:not(:disabled) {
    background: var(--surface-hover);
}
.vtl__link:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
}
.vtl__link:disabled {
    opacity: .6;
    cursor: default;
}
.vtl__link--danger {
    color: var(--danger);
}
.vtl__more {
    align-self: flex-start;
}
.vtl__error {
    margin: 0;
    color: var(--danger);
    font: var(--text-small);
}
@media (max-width: 480px) {
    .vtl__row {
        flex-wrap: wrap;
    }
    .vtl__pick {
        flex-basis: 100%;
    }
}
</style>
