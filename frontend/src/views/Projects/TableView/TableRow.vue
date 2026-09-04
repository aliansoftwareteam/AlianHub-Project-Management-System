<template>
    <div ref="rowRef" class="tv2__row" :class="{ 'is-selected': selected }" @click="$emit('open', data)">
        <span @click.stop>
            <input
                v-if="canSelect"
                type="checkbox"
                class="ah-check"
                :checked="selected"
                :aria-label="data.TaskName"
                @click="$emit('select', data, $event)"
            />
        </span>

        <button type="button" class="tv2__name" :title="data.TaskName" @click.stop="$emit('open', data)">{{ data.TaskName }}</button>

        <span class="tv2__status" :style="statusStyle">{{ status.name }}</span>

        <span>
            <span v-if="owner" class="ah-avatar" :title="owner.Employee_Name">
                <img v-if="owner.Employee_profileImageURL" :src="owner.Employee_profileImageURL" :alt="owner.Employee_Name" />
                <template v-else>{{ initial(owner.Employee_Name) }}</template>
            </span>
        </span>

        <span class="tv2__cell-ai" @click.stop>
            <span v-if="summary.state === 'ready'" class="tv2__summary" :title="summary.summary">{{ summary.summary }}</span>
            <span v-else-if="summary.state === 'loading'" class="tv2__summary tv2__summary--empty">{{ $t('List.ai_loading') }}</span>
            <span v-else-if="summary.state === 'empty'" class="tv2__summary tv2__summary--empty">{{ $t('List.ai_nothing_to_summarise') }}</span>
            <span v-else-if="summary.state === 'unavailable'" class="tv2__summary tv2__summary--empty">{{ $t('List.ai_not_configured') }}</span>
            <button v-else type="button" class="tv2__gen" @click="generate">✦ {{ $t('List.ai_generate') }}</button>

            <span v-if="summary.state === 'ready'" class="tv2__source" :class="{ 'is-pinned': summary.pinned }">
                <span>{{ sourceLabel }}</span>
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

        <span class="tv2__risk" :class="`tv2__risk--${risk.level}`" :title="riskTitle">
            <span class="tv2__risk-dot"></span>{{ $t(`List.risk_${risk.level}`) }} · {{ risk.score }}
        </span>

        <span class="tv2__cell-ai" @click.stop>
            <span v-if="category.state === 'ready'" class="tv2__area" :title="categoryTitle">{{ category.category }}</span>
            <span v-else-if="category.state === 'loading'" class="tv2__area-empty">{{ $t('Category.loading') }}</span>
            <span v-else-if="category.state === 'empty'" class="tv2__area-empty" :title="categoryTitle">{{ $t(`Category.empty_${category.reason === 'no-vocabulary' ? 'no_vocabulary' : 'no_fit'}`) }}</span>
            <span v-else-if="category.state === 'unavailable'" class="tv2__area-empty">{{ $t('List.ai_not_configured') }}</span>
            <button v-else type="button" class="tv2__gen" @click="generateCategory">✦ {{ $t('List.ai_generate') }}</button>

            <span v-if="category.state === 'ready'" class="tv2__source" :class="{ 'is-pinned': category.pinned }">
                <span>{{ categorySource }}</span>
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
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useGetterFunctions } from "@/composable";
import { taskRisk } from "@/views/Projects/composables/taskRisk";
import { useTaskSummaries } from "./useTaskSummaries.js";
import { useTaskCategories } from "./useTaskCategories.js";

defineOptions({ name: "TableRow" });

const props = defineProps({
    data: { type: Object, required: true },
    selected: { type: Boolean, default: false },
    canSelect: { type: Boolean, default: false }
});
defineEmits(["open", "select"]);

const { t } = useI18n();
const { getUser, getTaskStatus } = useGetterFunctions();
const summaries = useTaskSummaries();
const categories = useTaskCategories();
const rowRef = ref(null);
let observer = null;

const status = computed(() => getTaskStatus(props.data.statusKey) || { name: props.data.status?.text || "" });
const statusStyle = computed(() => (status.value.bgColor
    ? { background: status.value.bgColor, color: status.value.textColor }
    : {}));

const owner = computed(() => {
    const id = props.data.AssigneeUserId?.[0];
    return id ? getUser(id) : null;
});
const initial = (name) => String(name || "?").trim().charAt(0).toUpperCase();

const summary = computed(() => summaries.get(props.data._id));
const sourceLabel = computed(() => t("List.ai_source", {
    time: summary.value.updatedAt ? moment(summary.value.updatedAt).format("HH:mm") : "--:--"
}));

const category = computed(() => categories.get(props.data._id));
const categorySourceName = computed(() => (category.value.source === "custom-field" && category.value.sourceName)
    ? category.value.sourceName
    : t(`Category.source_${(category.value.source || "tag").replace("-", "_")}`));
const categorySource = computed(() => t("Category.chip_source", {
    from: categorySourceName.value,
    time: category.value.updatedAt ? moment(category.value.updatedAt).format("HH:mm") : "--:--"
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
        summaries.ensure(props.data._id);
        categories.ensure(props.data._id);
        observer.disconnect();
        observer = null;
    }, { rootMargin: "120px" });
    observer.observe(rowRef.value);
});
onBeforeUnmount(() => {
    if (observer) observer.disconnect();
});
</script>
