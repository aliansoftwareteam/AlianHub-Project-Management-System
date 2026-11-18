<template>
    <span class="ftu" :class="{ 'ftu--compact': compact }">
        <input
            v-if="editing"
            ref="input"
            v-model="draft"
            class="ftu__input"
            type="url"
            inputmode="url"
            :aria-label="label"
            :placeholder="$t('FieldTypes.url_placeholder')"
            @keydown.enter.prevent="commit"
            @keydown.esc="cancel"
            @blur="commit"
        />
        <template v-else>
            <button
                v-if="editable"
                ref="trigger"
                type="button"
                class="ftu__edit"
                :class="{ 'is-empty': !shown }"
                data-cell-edit
                data-url-edit
                :aria-label="shown ? $t('List.cell_change', { field: label, value: shown }) : $t('List.cell_set', { field: label })"
                :title="$t('FieldTypes.url_edit')"
                @click="start"
            >
                <ShellIcon :name="shown ? 'edit' : 'plus'" :size="12" />
            </button>
            <a v-if="href" class="ftu__link" :href="href" target="_blank" rel="noopener noreferrer" :title="href" @click.stop>{{ compact ? host : href }}</a>
            <span v-else-if="stored" class="ftu__text" :title="$t('FieldTypes.url_not_a_link')">{{ stored }}</span>
        </template>
    </span>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { hostOf, safeHref } from "@fieldTypes/url";

defineOptions({ name: "UrlFieldValue" });

const props = defineProps({
    def: { type: Object, required: true },
    value: { type: [String, Number, Array, Object], default: "" },
    editable: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    label: { type: String, default: "" }
});
const emit = defineEmits(["change"]);

const stored = computed(() => (typeof props.value === "string" ? props.value.trim() : ""));
const href = computed(() => safeHref(stored.value));
const host = computed(() => hostOf(stored.value));
const shown = computed(() => href.value || stored.value);

const editing = ref(false);
const draft = ref("");
const input = ref(null);
const trigger = ref(null);

function start() {
    draft.value = shown.value;
    editing.value = true;
    nextTick(() => input.value?.focus());
}

function finish() {
    editing.value = false;
    nextTick(() => trigger.value?.focus());
}

function commit() {
    if (!editing.value) return;
    const typed = draft.value.trim();
    finish();
    if (typed !== shown.value) emit("change", typed);
}

function cancel() {
    if (!editing.value) return;
    finish();
}
</script>

<style>
.ftu { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; }
.ftu__link, .ftu__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ftu__link { color: var(--brand); text-decoration: none; border-radius: 4px; }
.ftu__link:hover { text-decoration: underline; }
.ftu__link:focus-visible, .ftu__edit:focus-visible, .ftu__input:focus-visible { outline: none; box-shadow: var(--focus); }
.ftu__text { color: var(--ink-2); }
.ftu__edit {
    order: 2; flex: none;
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink-2); cursor: pointer;
}
.ftu__edit:hover { background: var(--surface-hover); color: var(--ink); }
.ftu__input {
    width: 100%; min-width: 0; height: 26px;
    padding: 2px 6px;
    border: 1px solid var(--brand); border-radius: 6px;
    background: var(--surface); color: var(--ink); font: inherit;
}
</style>
