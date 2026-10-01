<template>
    <div ref="rowRef" class="tv2__row" :class="{ 'is-selected': selected, 'is-sub': depth > 0 }" role="row" :data-row="data._id" v-bind="taskNavAttrs(data)" @click="$emit('open', data)">
        <span role="cell" data-col="select" tabindex="-1" @click.stop>
            <input
                v-if="canSelect"
                type="checkbox"
                class="ah-check"
                :checked="selected"
                :aria-label="data.TaskName"
                @click="$emit('select', data, $event)"
                @keydown.shift="$emit('select', data, $event)"
            />
        </span>

        <span role="cell" class="tv2__name-cell" data-col="name" tabindex="-1" :style="{ '--tv2-depth': depth }">
            <button
                v-if="canNest && hasSubtasks"
                type="button"
                class="tv2__disclose"
                :aria-expanded="expanded"
                :aria-label="$t('List.toggle_subtasks')"
                @click.stop="$emit('toggle-subtasks')"
            >{{ expanded ? '▾' : '▸' }}</button>
            <span v-else class="tv2__disclose tv2__disclose--none" aria-hidden="true"></span>
            <button type="button" class="tv2__name" data-cell-primary :title="data.TaskName" @click.stop="$emit('open', data)">{{ data.TaskName }}</button>
            <span v-if="progress" class="tv2__sub-count">{{ progress.done }}/{{ progress.total }}</span>
        </span>

        <template v-for="column in shownColumns" :key="column.id">
            <span v-if="column.id === 'status'" role="cell" :data-col="column.id" tabindex="-1" class="tv2__status-cell">
                <ListStatusCircle
                    v-if="edit && rights.status"
                    chip
                    :task="data"
                    :statuses="edit.statuses.value"
                    editable
                    @change="(next) => edit.setStatus(data, next, { row: rowRef })"
                />
                <span v-else class="ah-chip tv2__status ah-status-ink" :style="statusStyle">{{ status.name }}</span>
            </span>

            <span v-else-if="column.id === 'tags'" role="cell" :data-col="column.id" tabindex="-1" class="tv2__tags">
                <TaskTagCell :task="data" />
            </span>

            <span v-else-if="column.id === 'summary'" role="cell" :data-col="column.id" tabindex="-1" class="tv2__cell-ai" @click.stop>
                <span v-if="summary.state === 'ready'" class="tv2__summary" :title="summary.summary">{{ summary.summary }}</span>
                <span v-else-if="summary.state === 'loading'" class="tv2__summary tv2__summary--empty">{{ $t('List.ai_loading') }}</span>
                <span v-else-if="summary.state === 'empty'" class="tv2__summary tv2__summary--empty">{{ $t('List.ai_nothing_to_summarise') }}</span>
                <span v-else-if="summary.state === 'unavailable'" class="tv2__summary tv2__summary--empty">{{ $t('List.ai_not_configured') }}</span>
                <span v-else-if="summary.state === 'reading'" class="tv2__summary tv2__summary--empty" aria-hidden="true"></span>
                <button v-else type="button" class="tv2__gen" @click="generate">✦ {{ $t('List.ai_generate') }}</button>

                <span v-if="summary.state === 'ready'" class="tv2__source" :class="{ 'is-pinned': summary.pinned, 'is-stale': summary.stale }">
                    <span v-if="summary.stale" data-test="ai-stale" :title="$t('List.ai_from_hint')">{{ $t('List.ai_from', { time: madeAt(summary) }) }}</span>
                    <span v-else>{{ sourceLabel }}</span>
                    <button v-if="!summary.pinned" type="button" class="tv2__pin" data-test="ai-regenerate" :title="$t('List.ai_regenerate_hint')" @click="generate">
                        <ShellIcon name="refresh" :size="11" />{{ $t('List.ai_regenerate') }}
                    </button>
                    <button
                        type="button"
                        class="tv2__pin"
                        :class="{ 'is-on': summary.pinned }"
                        :title="summary.pinned ? $t('List.ai_unpin') : $t('List.ai_pin')"
                        @click="togglePin"
                    >
                        <ShellIcon name="pin" :size="11" />{{ summary.pinned ? $t('List.ai_pinned') : $t('List.ai_pin') }}
                    </button>
                </span>
            </span>

            <span v-else-if="column.id === 'risk'" role="cell" :data-col="column.id" tabindex="-1" class="tv2__risk" :class="`tv2__risk--${risk.level}`" :title="riskTitle">
                <span class="tv2__risk-dot"></span>{{ $t(`List.risk_${risk.level}`) }} · {{ risk.score }}
            </span>

            <span v-else-if="column.id === 'area'" role="cell" :data-col="column.id" tabindex="-1" class="tv2__cell-ai" @click.stop>
                <span v-if="category.state === 'ready'" class="ah-chip tv2__area" :title="categoryTitle">{{ category.category }}</span>
                <span v-else-if="category.state === 'loading'" class="tv2__area-empty">{{ $t('Category.loading') }}</span>
                <span v-else-if="category.state === 'empty'" class="tv2__area-empty" :title="categoryTitle">{{ $t(`Category.empty_${category.reason === 'no-vocabulary' ? 'no_vocabulary' : 'no_fit'}`) }}</span>
                <span v-else-if="category.state === 'unavailable'" class="tv2__area-empty">{{ $t('List.ai_not_configured') }}</span>
                <span v-else-if="category.state === 'reading'" class="tv2__area-empty" aria-hidden="true"></span>
                <button v-else type="button" class="tv2__gen" @click="generateCategory">✦ {{ $t('List.ai_generate') }}</button>

                <span v-if="category.state === 'ready'" class="tv2__source" :class="{ 'is-pinned': category.pinned, 'is-stale': category.stale }">
                    <span v-if="category.stale" data-test="ai-stale" :title="$t('List.ai_from_hint')">{{ $t('List.ai_from', { time: madeAt(category) }) }}</span>
                    <span v-else>{{ categorySource }}</span>
                    <button v-if="!category.pinned" type="button" class="tv2__pin" data-test="ai-regenerate" :title="$t('List.ai_regenerate_hint')" @click="generateCategory">
                        <ShellIcon name="refresh" :size="11" />{{ $t('List.ai_regenerate') }}
                    </button>
                    <button
                        type="button"
                        class="tv2__pin"
                        :class="{ 'is-on': category.pinned }"
                        :title="category.pinned ? $t('List.ai_unpin') : $t('List.ai_pin')"
                        @click="toggleCategoryPin"
                    >
                        <ShellIcon name="pin" :size="11" />{{ category.pinned ? $t('List.ai_pinned') : $t('List.ai_pin') }}
                    </button>
                </span>
            </span>

            <span v-else-if="column.id === 'doneBy'" role="cell" :data-col="column.id" tabindex="-1" class="tv2__done">
                <ProvenanceBadge :task="data" />
            </span>

            <span v-else role="cell" :data-col="column.id" tabindex="-1" class="tv2__cell" :class="{ 'tv2__cell--field': column.field }">
                <TaskColumnCell :column="column" :task="data" :parent="parent" :rowEl="rowRef" />
            </span>
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import ProvenanceBadge from "@/components/molecules/Provenance/ProvenanceBadge.vue";
import TaskTagCell from "@/components/molecules/TagList/TaskTagCell.vue";
import { useGetterFunctions } from "@/composable";
import { taskRisk } from "@/views/Projects/composables/taskRisk";
import { useTaskSummaries } from "./useTaskSummaries.js";
import { useTaskCategories } from "./useTaskCategories.js";
import { taskNavAttrs } from "@/components/organisms/TaskDetailOverlay/taskNavigation";
import { statusChipStyle } from "@/utils/statusChipColors";
import ListStatusCircle from "@/views/Projects/ListView/ListStatusCircle.vue";
import TaskColumnCell from "@/views/Projects/components/columns/TaskColumnCell.vue";
import { defaultColumns } from "@/views/Projects/composables/viewColumns";
import { MAX_DEPTH } from "@taskTreeRules";

defineOptions({ name: "TableRow" });

const props = defineProps({
    data: { type: Object, required: true },
    selected: { type: Boolean, default: false },
    canSelect: { type: Boolean, default: false },
    depth: { type: Number, default: 0 },
    parent: { type: Object, default: null },
    expanded: { type: Boolean, default: false },
    hasSubtasks: { type: Boolean, default: false },
    progress: { type: Object, default: null }
});
defineEmits(["open", "select", "toggle-subtasks"]);

const { t } = useI18n();
const { getTaskStatus } = useGetterFunctions();
const summaries = useTaskSummaries();
const categories = useTaskCategories();
const rowRef = ref(null);
let observer = null;

const edit = inject("listRowEdit", null);
const rights = computed(() => edit?.rights.value || {});
const injectedColumns = inject("tableColumns", null);
const shownColumns = computed(() => injectedColumns?.value || defaultColumns("table"));
const shows = (id) => shownColumns.value.some((column) => column.id === id);
const canNest = computed(() => props.depth < MAX_DEPTH);

const status = computed(() => getTaskStatus(props.data.statusKey) || { name: props.data.status?.text || "" });
const statusStyle = computed(() => (status.value.bgColor ? statusChipStyle(status.value) : {}));

/* A kept value can be days old: the time alone for one made today, the day with it otherwise. */
const madeAt = (entry) => {
    if (!entry.updatedAt) return "--:--";
    const made = moment(entry.updatedAt);
    return made.format(made.isSame(moment(), "day") ? "HH:mm" : "D MMM, HH:mm");
};

const summary = computed(() => summaries.get(props.data._id));
const sourceLabel = computed(() => t("List.ai_source", { time: madeAt(summary.value) }));

const category = computed(() => categories.get(props.data._id));
const categorySourceName = computed(() => (category.value.source === "custom-field" && category.value.sourceName)
    ? category.value.sourceName
    : t(`Category.source_${(category.value.source || "tag").replace("-", "_")}`));
const categorySource = computed(() => t("Category.chip_source", {
    from: categorySourceName.value,
    time: madeAt(category.value)
}));
const categoryTitle = computed(() => (category.value.state === "empty"
    ? t(`Category.why_${category.value.reason === "no-vocabulary" ? "no_vocabulary" : "no_fit"}`)
    : t("Category.chip_hint", { from: categorySourceName.value })));

const risk = computed(() => taskRisk(props.data));
const riskTitle = computed(() => {
    const top = risk.value.top;
    if (!top) return t("List.risk_none");
    return t(`List.risk_factor_${top.key}`, {
        days: top.days || 0,
        pct: top.overPct || 0,
        done: top.done || 0,
        total: top.total || 0
    });
});

function generate() {
    summaries.generate(props.data._id);
}
function togglePin() {
    if (summary.value.pinned) summaries.unpin(props.data._id);
    else summaries.pin(props.data._id);
}
function generateCategory() {
    categories.generate(props.data._id);
}
function toggleCategoryPin() {
    if (category.value.pinned) categories.unpin(props.data._id);
    else categories.pin(props.data._id);
}

onMounted(() => {
    if (!rowRef.value || typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver((entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (shows("summary")) summaries.ensure(props.data._id);
        if (shows("area")) categories.ensure(props.data._id);
        observer.disconnect();
        observer = null;
    }, { rootMargin: "120px" });
    observer.observe(rowRef.value);
});
onBeforeUnmount(() => {
    if (observer) observer.disconnect();
});
</script>
