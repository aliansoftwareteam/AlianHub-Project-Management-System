<template>
    <CalenderCompo
        v-if="editable"
        class="lv2__cell-picker"
        :modelValue="pickerValue"
        :hideExtraLayouts="['time', 'minutes', 'hours', 'seconds']"
        menuClass="calender-menu-class-duedate"
        @click.stop
        @update:modelValue="(date) => emit('change', date)"
    >
        <template #trigger>
            <button
                type="button"
                class="lv2__cell-btn lv2__due"
                :class="{ 'is-empty': !text, 'lv2__due--overdue': overdue }"
                :aria-label="label"
                aria-haspopup="dialog"
            >
                <template v-if="text">{{ text }}</template>
                <ShellIcon v-else name="calendar" :size="14" class="lv2__cell-empty" aria-hidden="true" />
            </button>
        </template>
    </CalenderCompo>
    <span v-else class="lv2__due" :class="{ 'lv2__due--overdue': overdue }">{{ text }}</span>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import CalenderCompo from "@/components/atom/CalenderCompo/CalenderCompo.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { dueBucket, dueLabel } from "@/components/molecules/Home/homeFormat";

defineOptions({ name: "ListDueCell" });

const props = defineProps({
    task: { type: Object, required: true },
    editable: { type: Boolean, default: false },
    done: { type: Boolean, default: false }
});
const emit = defineEmits(["change"]);

const { t } = useI18n();

const text = computed(() => (props.task.DueDate ? dueLabel(props.task.DueDate, t) : ""));
const pickerValue = computed(() => (props.task.DueDate ? new Date(props.task.DueDate) : ""));

/* The mock reds "Today" as well as a past date: both are out of runway. */
const overdue = computed(() => {
    if (props.done) return false;
    const bucket = dueBucket(props.task);
    return bucket === "overdue" || bucket === "today";
});

const label = computed(() => {
    const field = t("List.due_date");
    return text.value ? t("List.cell_change", { field, value: text.value }) : t("List.cell_set", { field });
});
</script>
