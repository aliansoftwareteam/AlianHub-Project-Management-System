<template>
    <section class="evr__group" :aria-label="label || $t('Everything.tasks_label')">
        <button
            v-if="showHead"
            type="button"
            class="evr__group-head"
            :aria-expanded="open ? 'true' : 'false'"
            data-test="evr-group-head"
            @click="open = !open"
        >
            <ShellIcon :name="open ? 'chevronDown' : 'chevronRight'" :size="13" aria-hidden="true" />
            <span v-if="color" class="evr__dot" :style="{ background: color }" aria-hidden="true"></span>
            <span class="evr__group-name">{{ label }}</span>
            <span class="evr__group-count">{{ group.count }}</span>
        </button>
        <div v-show="open" class="evr__rows" role="list">
            <EverythingRow
                v-for="row in group.rows"
                :key="row._id"
                :task="row"
                :project="projects[String(row.ProjectID)] || null"
                @open="(task) => $emit('open', task)"
                @status="(task, status) => $emit('status', task, status)"
                @priority="(task, option) => $emit('priority', task, option)"
            />
            <div v-if="group.loading" class="evr__skeleton" data-test="evr-group-loading" aria-hidden="true">
                <span v-for="n in skeletonRows" :key="n" class="evr__skeleton-row"></span>
            </div>
            <div v-else-if="group.failed" class="evr__group-error" role="alert">
                <span>{{ $t('Everything.group_failed') }}</span>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('load', group.id)">{{ $t('Everything.retry') }}</button>
            </div>
            <button v-else-if="more" type="button" class="ah-btn ah-btn--ghost ah-btn--sm evr__more" data-test="evr-more" @click="$emit('load', group.id)">
                {{ $t('Everything.load_more') }}
            </button>
            <span ref="sentinel" class="evr__sentinel" aria-hidden="true"></span>
        </div>
    </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import EverythingRow from "./EverythingRow.vue";

defineOptions({ name: "EverythingGroup" });

const SKELETON_MAX = 3;

const props = defineProps({
    group: { type: Object, required: true },
    label: { type: String, default: "" },
    color: { type: String, default: "" },
    showHead: { type: Boolean, default: true },
    projects: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["load", "open", "status", "priority"]);

const open = ref(true);
const sentinel = ref(null);
const more = computed(() => !props.group.loaded || Boolean(props.group.nextCursor));
const skeletonRows = computed(() => Math.max(1, Math.min(SKELETON_MAX, props.group.count - props.group.rows.length)));

let observer = null;

/* An observer reports a change, not a state: a sentinel still on screen after a page lands would
 * never ask for the next one, so it is observed afresh whenever the group's rows change. */
function watchSentinel() {
    observer?.disconnect();
    if (!sentinel.value || typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (open.value && more.value && !props.group.loading && !props.group.failed) emit("load", props.group.id);
    }, { rootMargin: "200px" });
    observer.observe(sentinel.value);
}

onMounted(watchSentinel);
watch(() => [props.group.rows.length, props.group.loaded, props.group.nextCursor, open.value], () => nextTick(watchSentinel));
onBeforeUnmount(() => observer?.disconnect());
</script>
