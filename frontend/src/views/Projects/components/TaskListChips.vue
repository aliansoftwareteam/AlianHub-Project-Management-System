<template>
    <span v-if="shown.home || shown.chips.length" class="ah-list-chips">
        <span v-if="shown.home" class="ah-list-chips__home" data-home-list :title="shown.home">{{ shown.home }}</span>
        <span v-for="chip in shown.chips" :key="chip.id" class="ah-list-chips__chip" data-list-chip :title="chip.title">{{ chip.name }}</span>
        <span v-if="shown.more" class="ah-list-chips__chip ah-list-chips__chip--more" data-more-lists :title="shown.more.title" :aria-label="shown.more.title">{{ shown.more.text }}</span>
    </span>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { listChips } from "@/views/Projects/composables/taskListChips";

defineOptions({ name: "TaskListChips" });

const props = defineProps({
    /** A row as the Everything read sends it: `sprintArray` names its home list, `extraLists` the lists this viewer can open. */
    task: { type: Object, required: true }
});

const { t } = useI18n();
const shown = computed(() => listChips(props.task, t));
</script>

<style>
.ah-list-chips { display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; color: var(--ink-2); font: 400 var(--fs-xs, 11px) var(--font-ui); }
.ah-list-chips__home { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-list-chips__chip {
    flex: 0 1 auto; min-width: 0; max-width: 110px; height: 18px; box-sizing: border-box; padding: 0 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    border: 1px solid var(--border); border-radius: var(--r-sm, 6px); background: var(--surface); line-height: 16px;
}
.ah-list-chips__chip--more { flex: none; background: var(--fill); }
@media (max-width: 767px) {
    .ah-list-chips { max-width: 100%; }
}
</style>
