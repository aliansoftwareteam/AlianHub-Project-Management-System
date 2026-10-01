<template>
    <section class="hc-card hgl" data-test="goals-card" :aria-label="$t('Home.card_goals')">
        <div class="hc-card__head">
            <span class="hc-card__title">{{ $t('Home.card_goals') }}</span>
            <router-link class="hgl__all" data-test="goals-card-all" :to="{ name: 'Goals', params: { cid: companyId } }">{{ $t('Home.goals_all') }}</router-link>
            <button type="button" class="hgl__hide" data-test="goals-card-hide" :aria-label="$t('Home.hide_card')" :title="$t('Home.hide_card')" @click="$emit('hide')">
                <ShellIcon name="x" :size="13" />
            </button>
        </div>
        <p v-if="state === 'loading'" class="hc-hint hgl__note">{{ $t('Home.goals_loading') }}</p>
        <p v-else-if="state === 'failed'" class="hc-hint hgl__note" data-test="goals-card-failed">
            {{ $t('Home.goals_failed') }}
            <button type="button" class="hgl__retry" @click="load">{{ $t('Home.recents_retry') }}</button>
        </p>
        <EmptyState
            v-else-if="!shown.length"
            compact
            :heading-level="4"
            :message="$t(canCreate ? 'Home.goals_empty' : 'Home.goals_empty_guest')"
            :action-label="$t('Goals.new_goal')"
            :action-allowed="canCreate"
            data-test="goals-card-empty"
            @action="newGoal"
        />
        <ul v-else class="hgl__list">
            <li v-for="goal in shown" :key="goal._id">
                <router-link class="hgl__row" data-test="goals-card-row" :data-goal="goal._id" :to="{ name: 'Goal', params: { cid: companyId, goalId: goal._id } }">
                    <span class="hgl__top">
                        <span class="hgl__name">{{ goal.name }}</span>
                        <span v-if="goal.periodEnd" class="hgl__end">{{ $t('Goals.period_until', { end: formatDay(goal.periodEnd, locale) }) }}</span>
                    </span>
                    <span class="hgl__progress">
                        <GoalBar :value="goal.progressPct" :label="$t('Goals.progress_of', { name: goal.name })" />
                        <span class="hgl__pct">{{ goal.progressPct || 0 }}%</span>
                    </span>
                </router-link>
            </li>
        </ul>
    </section>
</template>

<script setup>
import { computed, inject, onMounted, ref, unref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import GoalBar from "@/views/Goals/GoalBar.vue";
import { formatDay } from "@/views/Goals/goalFormat";
import { groupGoals, listRequest, todayOf } from "@/views/Goals/goalRequest";
import { apiRequest } from "@/services";
import { ROLE_GUEST } from "@/utils/roles";

defineOptions({ name: "GoalsCard" });
defineEmits(["hide"]);

const SHOWN = 5;

const router = useRouter();
const { getters } = useStore();
const { locale } = useI18n();
const injectedCompany = inject("$companyId", "");
const companyId = computed(() => unref(injectedCompany));
const goals = ref([]);
const state = ref("loading");

const canCreate = computed(() => getters["settings/companyUserDetail"]?.roleType !== ROLE_GUEST);
/* The goals of the period under way come first, as on the Goals page. */
const shown = computed(() => groupGoals(goals.value, todayOf(new Date())).flatMap((group) => group.goals).slice(0, SHOWN));

async function load() {
    state.value = "loading";
    try {
        const { method, path } = listRequest({ mine: true });
        const res = await apiRequest(method, path);
        if (!res?.data?.status) throw new Error(res?.data?.statusText || "Goals not read");
        goals.value = Array.isArray(res.data.data) ? res.data.data : [];
        state.value = "ready";
    } catch (error) {
        state.value = "failed";
    }
}

const newGoal = () => router.push({ name: "Goals", params: { cid: companyId.value }, query: { new: "1" } }).catch(() => {});

onMounted(load);
</script>

<style scoped>
.hgl__all { display: inline-flex; align-items: center; min-height: var(--hit-min); color: var(--brand); font: 600 var(--fs-sm, 12px)/1.2 var(--font-ui); text-decoration: none; border-radius: var(--r-chip); }
.hgl__all:hover { text-decoration: underline; }
.hgl__all:focus-visible { outline: none; box-shadow: var(--focus); }
.hgl__hide {
    width: var(--control-h, 26px); height: var(--control-h, 26px); display: grid; place-items: center; flex: none;
    border: 0; border-radius: var(--r-chip); background: transparent; color: var(--ink-2); cursor: pointer;
}
.hgl__hide:hover { background: var(--surface-hover); color: var(--ink); }
.hgl__hide:focus-visible { outline: none; box-shadow: var(--focus); }
.hgl__note { margin: 0; }
.hgl__retry { display: inline-flex; align-items: center; min-height: var(--hit-min); border: 0; background: none; padding: 0; color: var(--brand); font: inherit; font-weight: 600; cursor: pointer; }
.hgl__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.hgl__row {
    display: flex; flex-direction: column; gap: 6px; padding: 7px 6px; min-width: 0;
    border-radius: var(--r-chip); color: var(--ink); text-decoration: none;
}
.hgl__row:hover { background: var(--surface-hover); }
.hgl__row:focus-visible { outline: none; box-shadow: var(--focus); }
.hgl__top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.hgl__name { flex: 1 1 auto; min-width: 0; font: 500 var(--fs-md, 13px)/1.35 var(--font-ui); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hgl__end { flex: none; font: 400 var(--fs-sm, 11.5px)/1.3 var(--font-ui); color: var(--ink-2); }
.hgl__progress { display: flex; align-items: center; gap: 8px; }
.hgl__pct { flex: none; min-width: 34px; text-align: end; font: 500 var(--fs-sm, 12px)/1 var(--font-mono); color: var(--ink); }
@media (max-width: 767px) {
    .hgl__row { min-height: 44px; }
    .hgl__hide { width: 44px; height: 44px; }
}
</style>
