<template>
    <ul v-if="chips.length" class="gsc">
        <li v-for="chip in chips" :key="`${chip.kind}-${chip.id}`" class="gsc__chip" :class="{ 'is-refused': chip.refused, 'is-unknown': !chip.known }" data-test="gsc-chip" :data-kind="chip.kind" :data-source="chip.id" :data-refused="chip.refused ? 'true' : null">
            <ShellIcon :name="chip.kind === 'sprintIds' ? 'layers' : 'checkSquare'" :size="12" />
            <span class="ah-sr-only">{{ $t(chip.kind === 'sprintIds' ? 'Goals.source_list' : 'Goals.source_task') }}</span>
            <span class="gsc__name">{{ chip.name }}</span>
            <span v-if="chip.projectName" class="gsc__project">{{ chip.projectName }}</span>
            <span v-if="chip.refused" class="ah-sr-only">{{ $t('Goals.source_refused') }}</span>
            <button v-if="removable" type="button" class="gsc__remove" data-test="gsc-remove" :disabled="busy" :aria-label="$t('Goals.source_remove', { name: chip.name })" :title="$t('Goals.source_remove', { name: chip.name })" @click="$emit('remove', chip)">
                <ShellIcon name="x" :size="11" />
            </button>
        </li>
    </ul>
</template>

<script setup>
import { computed } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { SOURCE_KINDS, sourcesOf } from "./goalRequest";
import { useGoalSources } from "./useGoalSources";

defineOptions({ name: "GoalSourceChips" });

const props = defineProps({
    sources: { type: Object, default: null },
    names: { type: Object, default: null },
    refused: { type: Object, default: null },
    removable: { type: Boolean, default: false },
    busy: { type: Boolean, default: false }
});
defineEmits(["remove"]);

const { sourceOf } = useGoalSources();

const linked = computed(() => sourcesOf(props.sources));
const chips = computed(() => {
    const refused = sourcesOf(props.refused);
    return SOURCE_KINDS.flatMap((kind) => linked.value[kind].map((id) => ({ ...sourceOf(kind, id, props.names), refused: refused[kind].includes(id) })));
});
</script>
