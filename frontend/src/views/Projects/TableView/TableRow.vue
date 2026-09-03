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
            <span v-else-if="summary.state === 'loading'" class="tv2__summary tv2__summary--empty">{{ $t('ListV2.ai_loading') }}</span>
            <span v-else-if="summary.state === 'empty'" class="tv2__summary tv2__summary--empty">{{ $t('ListV2.ai_nothing_to_summarise') }}</span>
            <span v-else-if="summary.state === 'unavailable'" class="tv2__summary tv2__summary--empty">{{ $t('ListV2.ai_not_configured') }}</span>
            <button v-else type="button" class="tv2__gen" @click="generate">✦ {{ $t('ListV2.ai_generate') }}</button>

            <span v-if="summary.state === 'ready'" class="tv2__source" :class="{ 'is-pinned': summary.pinned }">
                <span>{{ sourceLabel }}</span>
                <button
                    type="button"
                    class="tv2__pin"
                    :class="{ 'is-on': summary.pinned }"
                    :title="summary.pinned ? $t('ListV2.ai_unpin') : $t('ListV2.ai_pin')"
                    @click="togglePin"
                >
                    <ShellIcon name="pin" :size="11" />{{ summary.pinned ? $t('ListV2.ai_pinned') : $t('ListV2.ai_pin') }}
                </button>
            </span>
        </span>

        <span class="tv2__risk" :class="`tv2__risk--${risk.level}`" :title="riskTitle">
            <span class="tv2__risk-dot"></span>{{ $t(`ListV2.risk_${risk.level}`) }} · {{ risk.score }}
        </span>

        <span class="tv2__area" :title="$t('ListV2.area_hint')">{{ $t('ListV2.not_generated') }}</span>
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
const sourceLabel = computed(() => t("ListV2.ai_source", {
    time: summary.value.updatedAt ? moment(summary.value.updatedAt).format("HH:mm") : "--:--"
}));

const risk = computed(() => taskRisk(props.data));
const riskTitle = computed(() => {
    const top = risk.value.top;
    if (!top) return t("ListV2.risk_none");
    return t(`ListV2.risk_factor_${top.key}`, {
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

onMounted(() => {
    if (!rowRef.value || typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver((entries) => {
        if (!entries[0]?.isIntersecting) return;
        summaries.ensure(props.data._id);
        observer.disconnect();
        observer = null;
    }, { rootMargin: "120px" });
    observer.observe(rowRef.value);
});
onBeforeUnmount(() => {
    if (observer) observer.disconnect();
});
</script>
