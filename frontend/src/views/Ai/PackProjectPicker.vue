<template>
    <fieldset class="pp">
        <div class="pp__head">
            <legend class="ah-field__label pp__legend">{{ $t('TeamPacks.projects_label') }}</legend>
            <span class="ah-small pp__count" :data-test="`${testId}-count`">{{ $t('TeamPacks.projects_chosen', { n: modelValue.length, total: projects.length }) }}</span>
        </div>
        <p v-if="!projects.length" class="ah-small pp__muted" :data-test="emptyTestId">{{ emptyText }}</p>
        <template v-else>
            <div class="pp__tools">
                <input
                    v-model="query"
                    class="ah-input pp__search"
                    type="search"
                    :placeholder="$t('TeamPacks.projects_search')"
                    :aria-label="$t('TeamPacks.projects_search')"
                />
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="!canAddShown" @click="chooseShown">{{ $t('TeamPacks.projects_all') }}</button>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="!modelValue.length" @click="emit('update:modelValue', [])">{{ $t('TeamPacks.projects_none') }}</button>
            </div>
            <div class="pp__list ah-scroll">
                <label
                    v-for="project in projects"
                    v-show="matches(project)"
                    :key="project.id"
                    class="pp__row"
                    :class="{ 'pp__row--off': project.why, 'pp__row--on': modelValue.includes(project.id) }"
                    :data-test="testId"
                    :data-why="project.why || null"
                >
                    <input
                        class="ah-check"
                        type="checkbox"
                        :value="project.id"
                        :checked="modelValue.includes(project.id)"
                        :disabled="Boolean(project.why) || (atCap && !modelValue.includes(project.id))"
                        @change="toggle(project.id, $event.target.checked)"
                    />
                    <span class="pp__text">
                        <span class="pp__name">{{ project.name }}</span>
                        <span v-if="project.why" class="ah-small pp__muted">{{ $t(`TeamPacks.why_${project.why}`) }}</span>
                    </span>
                </label>
                <p v-if="!shown.length" class="ah-small pp__muted pp__nothing">{{ $t('TeamPacks.projects_no_match') }}</p>
            </div>
        </template>
        <span v-if="hint || atCap" class="ah-field__hint" :data-test="`${testId}s-hint`">{{ atCap ? $t('TeamPacks.projects_cap', { n: max }) : hint }}</span>
    </fieldset>
</template>

<script setup>
import { computed, ref } from "vue";

defineOptions({ name: "PackProjectPicker" });

const props = defineProps({
    projects: { type: Array, default: () => [] },
    modelValue: { type: Array, default: () => [] },
    max: { type: Number, default: 50 },
    testId: { type: String, required: true },
    emptyTestId: { type: String, default: null },
    emptyText: { type: String, default: "" },
    hint: { type: String, default: "" }
});
const emit = defineEmits(["update:modelValue"]);

const query = ref("");
const atCap = computed(() => props.modelValue.length >= props.max);
const matches = (project) => !query.value.trim() || project.name.toLowerCase().includes(query.value.trim().toLowerCase());
const shown = computed(() => props.projects.filter(matches));
const canAddShown = computed(() => !atCap.value && shown.value.some((project) => !project.why && !props.modelValue.includes(project.id)));

function toggle(id, on) {
    const rest = props.modelValue.filter((one) => one !== id);
    emit("update:modelValue", on ? [...rest, id] : rest);
}

function chooseShown() {
    const room = props.max - props.modelValue.length;
    const add = shown.value.filter((project) => !project.why && !props.modelValue.includes(project.id)).slice(0, room).map((project) => project.id);
    emit("update:modelValue", [...props.modelValue, ...add]);
}
</script>

<style>
.pp { margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pp__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.pp__legend { float: left; padding: 0; margin: 0; }
.pp__count { color: var(--ink-2); }
.pp__muted { color: var(--ink-2); }
.pp__tools { display: flex; align-items: center; gap: 6px; }
.pp__search { flex: 1; min-width: 0; }
.pp__list { max-height: 264px; overflow: auto; border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface); padding: 4px; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 2px; align-content: start; }
.pp__row { display: flex; align-items: flex-start; gap: 10px; padding: 7px 8px; border-radius: var(--r-sm); cursor: pointer; color: var(--ink); min-width: 0; transition: background var(--t-state) var(--ease); }
.pp__row:hover { background: var(--surface-hover); }
.pp__row--on { background: var(--brand-tint); }
.pp__row--off { cursor: default; color: var(--ink-2); }
.pp__row--off:hover { background: transparent; }
.pp__row .ah-check { flex: none; margin-top: 2px; }
.pp__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pp__name { font-weight: 500; line-height: 1.35; overflow-wrap: anywhere; }
.pp__nothing { grid-column: 1 / -1; padding: 8px; margin: 0; }
@media (max-width: 480px) {
    .pp__list { grid-template-columns: 1fr; }
    .pp__tools { flex-wrap: wrap; }
    .pp__search { flex-basis: 100%; }
}
</style>
