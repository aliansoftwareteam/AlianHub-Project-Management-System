<template>
    <PriorityComp
        v-if="editable"
        class="lv2__cell-picker"
        :priorityVal="task.Task_Priority || ''"
        @select="(option) => emit('change', option)"
    >
        <template #trigger="{ open }">
            <button
                type="button"
                class="lv2__cell-btn"
                :class="{ 'is-empty': !name }"
                :aria-label="label"
                aria-haspopup="dialog"
                @click.stop="open()"
            >
                <span v-if="name" class="ah-chip" :class="tone">{{ name }}</span>
                <span v-else class="lv2__cell-empty lv2__cell-flag" aria-hidden="true">⚑</span>
            </button>
        </template>
    </PriorityComp>
    <span v-else-if="name" class="ah-chip" :class="tone">{{ name }}</span>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import PriorityComp from "@/components/molecules/PriorityCompo/PriorityComp.vue";
import { priorityMeta } from "@/components/molecules/Home/homeFormat";

defineOptions({ name: "ListPriorityCell" });

const props = defineProps({
    task: { type: Object, required: true },
    editable: { type: Boolean, default: false }
});
const emit = defineEmits(["change"]);

const { t } = useI18n();
const { getters } = useStore();

/* The chip tone keys off the built-in priority key, but the word only ever comes from
 * the company's own vocabulary: a workspace that renames or adds a priority must not
 * have the row state one it never defined. */
const tone = computed(() => priorityMeta(props.task.Task_Priority).cls);
const name = computed(() => {
    if (!props.task.Task_Priority) return "";
    const found = (getters["settings/companyPriority"] || []).find((p) => p.value === props.task.Task_Priority);
    return found?.name && found.name !== "N/A" ? found.name : "";
});

const label = computed(() => {
    const field = t("List.priority");
    return name.value ? t("List.cell_change", { field, value: name.value }) : t("List.cell_set", { field });
});
</script>
