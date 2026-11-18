<template>
    <section
        class="evr__col"
        :class="{ 'is-over': over && accepts, 'is-refusing': Boolean(dragged) && !accepts }"
        role="listitem"
        :aria-label="group.key"
        data-test="evr-col"
        @dragover="onDragOver"
        @dragleave="over = false"
        @drop.prevent="onDrop"
    >
        <header class="evr__col-head">
            <span v-if="color" class="evr__dot" :style="{ background: color }" aria-hidden="true"></span>
            <span class="evr__col-name" :title="group.key">{{ group.key }}</span>
            <span class="evr__group-count">{{ group.count }}</span>
        </header>
        <div class="evr__col-body ah-scroll" role="list">
            <EverythingCard
                v-for="row in group.rows"
                :key="row._id"
                :task="row"
                :project="projects[String(row.ProjectID)] || null"
                @open="(task) => $emit('open', task)"
                @status="(task, status) => $emit('status', task, status)"
                @priority="(task, option) => $emit('priority', task, option)"
                @drag-start="(task) => $emit('drag-start', task)"
                @drag-end="$emit('drag-end')"
            />
            <p v-if="group.loaded && !group.rows.length && !group.loading" class="evr__col-empty">{{ $t('Everything.column_empty') }}</p>
            <EverythingGroupFoot :group="group" :more="more" @load="$emit('load', group.id)" />
            <span ref="sentinel" class="evr__sentinel" aria-hidden="true"></span>
        </div>
    </section>
</template>

<script setup>
import { computed, ref } from "vue";
import EverythingCard from "./EverythingCard.vue";
import EverythingGroupFoot from "./EverythingGroupFoot.vue";
import { dropDecision } from "./everythingRequest";
import { useLoadWhenSeen } from "./useLoadWhenSeen";

defineOptions({ name: "EverythingColumn" });

const props = defineProps({
    group: { type: Object, required: true },
    color: { type: String, default: "" },
    projects: { type: Object, default: () => ({}) },
    dragged: { type: Object, default: null }
});
const emit = defineEmits(["load", "open", "status", "priority", "drag-start", "drag-end", "drop-card"]);

const over = ref(false);
const { sentinel, more } = useLoadWhenSeen(() => props.group, (id) => emit("load", id));

const accepts = computed(() => Boolean(props.dragged)
    && dropDecision(props.dragged, props.projects[String(props.dragged.ProjectID)] || null, props.group.key).allowed);

/* Every column takes the drop, the ones that will refuse it too: a browser sends no drop event to a
 * target that declined the drag, and a refusal has to be able to say why. */
function onDragOver(event) {
    if (!props.dragged) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    over.value = true;
}

function onDrop() {
    over.value = false;
    emit("drop-card", props.group);
}
</script>
