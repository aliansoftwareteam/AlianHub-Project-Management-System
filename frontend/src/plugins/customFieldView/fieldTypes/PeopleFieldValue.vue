<template>
    <Assignee
        v-if="editable"
        class="ftpe"
        :class="{ 'ftpe--compact': compact }"
        :users="ids"
        :options="options"
        :multiSelect="multiple"
        :isDisplayTeam="false"
        :showAddUser="false"
        @selected="add"
        @removed="remove"
    >
        <template #trigger="{ open }">
            <button
                type="button"
                class="ftpe__btn"
                data-cell-edit
                :aria-label="buttonLabel"
                :title="names || null"
                aria-haspopup="dialog"
                @click.stop="open()"
            >
                <span v-for="person in shown" :key="person.id" class="ftpe__person" data-person>
                    <span class="ah-avatar ah-avatar--sm" aria-hidden="true">
                        <AvatarImage :src="person.image">{{ person.initial }}</AvatarImage>
                    </span>
                    <span class="ftpe__name">{{ person.name }}</span>
                </span>
                <span v-if="hidden" class="ftpe__more" aria-hidden="true">+{{ hidden }}</span>
                <ShellIcon v-if="!people.length" name="plus" :size="12" class="ftpe__empty" aria-hidden="true" />
            </button>
        </template>
    </Assignee>
    <span v-else-if="people.length" class="ftpe ftpe__value" :class="{ 'ftpe--compact': compact }" role="img" :aria-label="readLabel" :title="names">
        <span v-for="person in shown" :key="person.id" class="ftpe__person" data-person>
            <span class="ah-avatar ah-avatar--sm">
                <AvatarImage :src="person.image">{{ person.initial }}</AvatarImage>
            </span>
            <span class="ftpe__name">{{ person.name }}</span>
        </span>
        <span v-if="hidden" class="ftpe__more">+{{ hidden }}</span>
    </span>
</template>

<script setup>
import AvatarImage from "@/components/atom/AvatarImage/AvatarImage.vue";
import { computed, inject, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import Assignee from "@/components/molecules/Assignee/Assignee.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useGetterFunctions } from "@/composable";
import { idsOf, isMultiple } from "@fieldTypes/people";
import { peopleOptions } from "./people";

defineOptions({ name: "PeopleFieldValue" });

const props = defineProps({
    def: { type: Object, required: true },
    value: { type: [Array, String], default: null },
    editable: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    label: { type: String, default: "" }
});
const emit = defineEmits(["change"]);

const { t } = useI18n();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const project = inject("selectedProject", ref({}));

const ids = computed(() => idsOf(props.value));
const multiple = computed(() => isMultiple(props.def));
const people = computed(() => ids.value.map((id) => {
    const user = getUser(id);
    const name = user.Employee_Name || "";
    return { id, name, image: user.Employee_profileImageURL || "", initial: (name.trim().charAt(0) || "?").toUpperCase() };
}));
const shown = computed(() => (props.compact ? people.value.slice(0, 1) : people.value));
const hidden = computed(() => people.value.length - shown.value.length);
const names = computed(() => people.value.map((person) => person.name).join(", "));

const options = computed(() => peopleOptions({
    project: project.value,
    seats: getters["settings/companyUsers"],
    teams: getters["settings/teams"],
    rules: getters["settings/rules"],
    current: ids.value
}));

const readLabel = computed(() => t("List.cell_value", { field: props.label, value: names.value }));
const buttonLabel = computed(() => (people.value.length
    ? t("List.cell_change", { field: props.label, value: names.value })
    : t("List.cell_set", { field: props.label })));

function add(user) {
    if (!user?.id) return;
    emit("change", multiple.value ? [...ids.value.filter((id) => id !== user.id), user.id] : [user.id]);
}

function remove(user) {
    emit("change", ids.value.filter((id) => id !== user?.id));
}
</script>

<style>
.ftpe { display: inline-flex; min-width: 0; max-width: 100%; }
.ftpe__btn, .ftpe__value {
    display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 8px;
    min-width: 24px; min-height: 24px; max-width: 100%;
    padding: 0 4px;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink); font: inherit; text-align: left;
}
.ftpe--compact .ftpe__btn, .ftpe--compact.ftpe__value { flex-wrap: nowrap; overflow: hidden; }
.ftpe__btn { cursor: pointer; }
.ftpe__btn:hover { background: var(--surface-hover); }
.ftpe__btn:focus-visible { outline: none; box-shadow: var(--focus); }
.ftpe__person { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.ftpe__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ftpe__more { flex: none; color: var(--ink-2); font: var(--text-small); }
.ftpe__empty { color: var(--ink-2); }
</style>
