<template>
    <li class="gls__item">
        <button
            type="button"
            class="gls__row"
            :class="{ 'is-open': open }"
            data-test="gls-row"
            :data-goal="goal._id"
            :aria-current="open ? 'true' : null"
            @click="$emit('open', goal)"
        >
            <span class="gls__dot" :style="goal.color ? { background: goal.color } : null" aria-hidden="true"></span>
            <span class="gls__title">
                <span class="gls__name">{{ goal.name }}</span>
                <span class="gls__meta">
                    <span class="gls__period">{{ period }}</span>
                    <span class="gls__reached" data-test="gls-reached">{{ reached }}</span>
                </span>
            </span>
            <span class="gls__vis" data-test="gls-vis" :data-visibility="goal.visibility" :title="visibility">
                <ShellIcon v-if="visibilityIcon" :name="visibilityIcon" :size="14" />
                <span class="ah-sr-only">{{ visibility }}</span>
            </span>
            <span class="ah-avatar ah-avatar--sm gls__owner" data-test="gls-owner" :title="ownedBy">
                <img v-if="owner.image" :src="owner.image" alt="" />
                <span v-else aria-hidden="true">{{ owner.initial }}</span>
                <span class="ah-sr-only">{{ ownedBy }}</span>
            </span>
            <span class="gls__progress">
                <GoalBar :value="goal.progressPct" :label="$t('Goals.progress_of', { name: goal.name })" />
                <span class="gls__pct">{{ goal.progressPct }}%</span>
            </span>
        </button>
    </li>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import GoalBar from "./GoalBar.vue";
import { periodLabel } from "./goalFormat";
import { reachedCount } from "./goalRequest";
import { useGoalPeople } from "./useGoalPeople";

defineOptions({ name: "GoalRow" });

const VISIBILITY_ICON = { private: "lock", people: "users" };

const props = defineProps({
    goal: { type: Object, required: true },
    open: { type: Boolean, default: false }
});
defineEmits(["open"]);

const { t, locale } = useI18n();
const { personOf } = useGoalPeople();

const owner = computed(() => personOf(props.goal.ownerUserId));
const ownedBy = computed(() => t("Goals.owned_by", { name: owner.value.name }));
const period = computed(() => periodLabel(props.goal, t, locale.value));
const reached = computed(() => {
    const total = (props.goal.targets || []).length;
    return total ? t("Goals.reached", { done: reachedCount(props.goal), total }) : t("Goals.no_targets");
});
const visibilityIcon = computed(() => VISIBILITY_ICON[props.goal.visibility] || "");
const visibility = computed(() => (props.goal.sharedWithMe ? t("Goals.shared_with_you") : t(`Goals.visibility_${props.goal.visibility}`)));
</script>
