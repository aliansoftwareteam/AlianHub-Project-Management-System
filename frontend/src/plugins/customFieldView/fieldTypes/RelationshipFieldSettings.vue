<template>
    <div class="ftrs">
        <div class="ah-field">
            <label class="ah-field__label" for="fb-link-max">{{ $t('FieldTypes.relationship_max_label') }}</label>
            <input
                id="fb-link-max"
                class="ah-input"
                :class="{ 'ah-input--error': error }"
                type="number"
                inputmode="numeric"
                step="1"
                data-link-max
                :min="MAX_RANGE.min"
                :max="MAX_RANGE.max"
                :value="modelValue.fieldLinkMax"
                aria-describedby="fb-link-max-hint"
                @input="set({ fieldLinkMax: $event.target.value })"
            />
            <span id="fb-link-max-hint" class="ftrs__hint">{{ $t('FieldTypes.relationship_max_hint', MAX_RANGE) }}</span>
        </div>
        <div class="ah-field">
            <label class="ah-field__label" for="fb-link-scope">{{ $t('FieldTypes.relationship_scope_label') }}</label>
            <select id="fb-link-scope" class="ah-input" data-link-scope :value="scope" @change="set({ fieldLinkScope: $event.target.value })">
                <option v-for="option in SCOPES" :key="option" :value="option">{{ $t(`FieldTypes.relationship_scope_${option}`) }}</option>
            </select>
        </div>
        <div v-if="scope !== 'any'" class="ah-field">
            <label class="ah-field__label" for="fb-link-project">{{ $t('FieldTypes.relationship_project_label') }}</label>
            <select
                id="fb-link-project"
                class="ah-input"
                :class="{ 'ah-input--error': error && !modelValue.fieldLinkProjectId }"
                data-link-project
                :value="modelValue.fieldLinkProjectId || ''"
                @change="set({ fieldLinkProjectId: $event.target.value, fieldLinkSprintId: '' })"
            >
                <option value="">{{ $t('FieldTypes.relationship_choose') }}</option>
                <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
        </div>
        <div v-if="scope === 'list'" class="ah-field">
            <label class="ah-field__label" for="fb-link-list">{{ $t('FieldTypes.relationship_list_label') }}</label>
            <select
                id="fb-link-list"
                class="ah-input"
                :class="{ 'ah-input--error': error && !modelValue.fieldLinkSprintId }"
                data-link-list
                :value="modelValue.fieldLinkSprintId || ''"
                @change="set({ fieldLinkSprintId: $event.target.value })"
            >
                <option value="">{{ $t('FieldTypes.relationship_choose') }}</option>
                <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
            </select>
        </div>
        <span v-if="error" class="ah-field__error" role="alert">{{ error }}</span>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import { MAX_RANGE, SCOPES } from "@fieldTypes/relationship";

defineOptions({ name: "RelationshipFieldSettings" });

const props = defineProps({
    modelValue: { type: Object, required: true },
    error: { type: String, default: "" }
});
const emit = defineEmits(["update:modelValue"]);

const { getters } = useStore();

const scope = computed(() => (SCOPES.includes(props.modelValue.fieldLinkScope) ? props.modelValue.fieldLinkScope : "any"));
const openProjects = computed(() => getters["projectData/onlyActiveProjects"]?.data || []);
const projects = computed(() => openProjects.value.map((project) => ({ id: String(project._id), name: project.ProjectName || "" })));

const listsIn = (sprints) => Object.values(sprints || {}).filter((sprint) => sprint && !sprint.deletedStatusKey);

/* A project's lists sit under it or inside its folders. */
const lists = computed(() => {
    const project = openProjects.value.find((candidate) => String(candidate._id) === String(props.modelValue.fieldLinkProjectId || ""));
    if (!project) return [];
    const inFolders = Object.values(project.sprintsfolders || {}).flatMap((folder) => listsIn(folder?.sprintsObj));
    return [...listsIn(project.sprintsObj), ...inFolders].map((sprint) => ({ id: String(sprint.id || sprint._id), name: sprint.name || "" }));
});

const set = (change) => emit("update:modelValue", { ...props.modelValue, ...change });
</script>

<style>
.ftrs { display: flex; flex-direction: column; gap: 16px; }
.ftrs__hint { color: var(--ink-2); font: var(--text-small); }
</style>
