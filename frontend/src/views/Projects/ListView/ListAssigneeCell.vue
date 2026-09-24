<template>
    <Assignee
        v-if="editable"
        class="lv2__cell-picker"
        :users="task.AssigneeUserId || []"
        :options="options"
        :multiSelect="multiple"
        :isDisplayTeam="false"
        :showAddUser="false"
        @selected="(user) => emit('change', { type: multiple ? 'add' : 'replace', uid: user.id })"
        @removed="(user) => emit('change', { type: 'remove', uid: user.id })"
    >
        <template #trigger="{ open }">
            <button
                type="button"
                class="lv2__cell-btn"
                :class="{ 'is-empty': !people.length }"
                :aria-label="label"
                :title="names"
                aria-haspopup="dialog"
                @click.stop="open()"
            >
                <template v-if="people.length">
                    <span class="ah-avatar" aria-hidden="true">
                        <img v-if="people[0].Employee_profileImageURL" :src="people[0].Employee_profileImageURL" alt="" />
                        <template v-else>{{ initial(people[0].Employee_Name) }}</template>
                    </span>
                    <span v-if="people.length > 1" class="lv2__cell-more" aria-hidden="true">+{{ people.length - 1 }}</span>
                </template>
                <ShellIcon v-else name="user" :size="14" class="lv2__cell-empty" aria-hidden="true" />
            </button>
        </template>
    </Assignee>
    <span v-else class="lv2__c-assignee-value" role="img" :aria-label="label" :title="names || null">
        <span v-if="people.length" class="ah-avatar">
            <img v-if="people[0].Employee_profileImageURL" :src="people[0].Employee_profileImageURL" alt="" />
            <template v-else>{{ initial(people[0].Employee_Name) }}</template>
        </span>
    </span>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Assignee from "@/components/molecules/Assignee/Assignee.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useGetterFunctions } from "@/composable";

defineOptions({ name: "ListAssigneeCell" });

const props = defineProps({
    task: { type: Object, required: true },
    editable: { type: Boolean, default: false },
    options: { type: Array, default: () => [] },
    multiple: { type: Boolean, default: false }
});
const emit = defineEmits(["change"]);

const { t } = useI18n();
const { getUser } = useGetterFunctions();

const people = computed(() => (props.task.AssigneeUserId || []).filter((id) => id && !String(id).startsWith("tId_")).map((id) => getUser(id)));
const names = computed(() => people.value.map((user) => user.Employee_Name).join(", "));
const initial = (name) => String(name || "?").trim().charAt(0).toUpperCase();

const label = computed(() => {
    const field = t("List.assignee");
    if (!people.value.length) return t(props.editable ? "List.cell_set" : "List.cell_none", { field });
    return t(props.editable ? "List.cell_change" : "List.cell_value", { field, value: names.value });
});
</script>
