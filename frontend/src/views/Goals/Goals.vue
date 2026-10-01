<template>
    <div class="ah-page gls" :class="{ 'gls--open': Boolean(openId) }">
        <div class="gls__main">
            <header class="ah-toolbar gls__toolbar">
                <h1 ref="heading" class="ah-toolbar__title" tabindex="-1">{{ $t('Goals.title') }}</h1>
                <span v-if="status === 'ready' && goals.length" class="gls__total">{{ $t('Goals.count', { n: goals.length }, goals.length) }}</span>
                <span class="ah-toolbar__spacer"></span>
                <button v-if="canCreate" ref="newButton" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="gls-new" @click="creating = true">
                    <ShellIcon name="plus" :size="13" />{{ $t('Goals.new_goal') }}
                </button>
            </header>

            <div class="gls__controls">
                <div class="ah-tabs" role="group" :aria-label="$t('Goals.scope_label')">
                    <button type="button" class="ah-tab" :class="{ 'is-active': !filters.mine }" :aria-pressed="filters.mine ? 'false' : 'true'" data-test="gls-scope-all" @click="filter({ mine: false })">
                        {{ $t('Goals.scope_all') }}
                    </button>
                    <button type="button" class="ah-tab" :class="{ 'is-active': filters.mine }" :aria-pressed="filters.mine ? 'true' : 'false'" data-test="gls-scope-mine" @click="filter({ mine: true })">
                        {{ $t('Goals.scope_mine') }}
                    </button>
                </div>
                <button type="button" class="gls__chip" :class="{ 'is-on': filters.archived }" :aria-pressed="filters.archived ? 'true' : 'false'" data-test="gls-archived" @click="filter({ archived: !filters.archived })">
                    {{ $t('Goals.archived') }}
                </button>
                <label class="gls__pick">
                    <span>{{ $t('Goals.sort_by') }}</span>
                    <select v-model="sort" class="ah-input gls__select" data-test="gls-sort">
                        <option v-for="option in SORTS" :key="option" :value="option">{{ $t(`Goals.sort_${option}`) }}</option>
                    </select>
                </label>
            </div>

            <div ref="body" class="gls__body ah-scroll" :aria-busy="loading ? 'true' : 'false'">
                <GoalCreate v-if="creating" @created="created" @cancel="stopCreating" />

                <div v-if="loading" class="gls__skeleton" role="status" :aria-label="$t('Goals.loading')" data-test="gls-loading">
                    <span v-for="n in 6" :key="n" class="gls__skeleton-row"></span>
                </div>
                <div v-else-if="status === 'error'" class="ah-empty gls__state" role="alert" data-test="gls-error">
                    <strong>{{ $t('Goals.error_title') }}</strong>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="gls-retry" @click="reload">{{ $t('Goals.retry') }}</button>
                </div>
                <div v-else-if="!goals.length" class="ah-empty gls__state" data-test="gls-empty">
                    <strong>{{ $t(`Goals.empty_${emptyKind}title`) }}</strong>
                    <span>{{ $t(`Goals.empty_${emptyKind}hint`) }}</span>
                    <button v-if="canCreate && !filters.archived && !creating" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="gls-empty-new" @click="creating = true">
                        {{ $t('Goals.new_goal') }}
                    </button>
                </div>
                <template v-else>
                    <section v-for="group in groups" :key="group.id" class="gls__group" :data-group="group.id" :aria-labelledby="`gls-group-${group.id}`">
                        <div class="gls__group-head">
                            <h2 :id="`gls-group-${group.id}`" class="gls__group-name">{{ $t(`Goals.group_${group.id}`) }}</h2>
                            <span class="gls__group-count">{{ group.goals.length }}</span>
                        </div>
                        <ul class="gls__rows">
                            <GoalRow v-for="goal in group.goals" :key="goal._id" :goal="goal" :open="goal._id === openId" @open="openGoal" />
                        </ul>
                    </section>
                </template>
            </div>
        </div>

        <GoalPanel v-if="openId" :key="openId" :state="open" @close="closeGoal" @retry="readOpen" />
    </div>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import GoalCreate from "./GoalCreate.vue";
import GoalPanel from "./GoalPanel.vue";
import GoalRow from "./GoalRow.vue";
import { COUNT_POLL_LIMIT, COUNT_POLL_MS } from "@/store/Goals";
import { SORTS, groupGoals, todayOf } from "./goalRequest";
import { useGoalPeople } from "./useGoalPeople";
import "./style.css";

defineOptions({ name: "GoalsPage" });

const CHANGED = "goalsChanged";
const TOAST = { position: "top-right" };

const store = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const toast = useToast();
const { isGuest } = useGoalPeople();
const companyId = inject("$companyId", ref(""));

const status = computed(() => store.getters["goals/status"]);
const goals = computed(() => store.getters["goals/goals"]);
const filters = computed(() => store.getters["goals/filters"]);
const open = computed(() => store.getters["goals/open"]);
const loading = computed(() => status.value === "loading" || status.value === "idle");
const canCreate = computed(() => !isGuest.value);
const openId = computed(() => (route.name === "Goal" ? String(route.params.goalId || "") : ""));

const sort = ref(SORTS[0]);
const creating = ref(false);
const body = ref(null);
const heading = ref(null);
const newButton = ref(null);

const groups = computed(() => groupGoals(goals.value, todayOf(new Date()), sort.value));
const emptyKind = computed(() => {
    if (isGuest.value) return "guest_";
    if (filters.value.archived) return "archived_";
    return filters.value.mine ? "mine_" : "";
});

const reload = () => store.dispatch("goals/load");
const filter = (patch) => store.dispatch("goals/applyFilters", patch);
const readOpen = () => store.dispatch("goals/open", openId.value);

const rowOf = (id) => body.value?.querySelector(`[data-goal="${id}"]`);
const openGoal = (goal) => router.push({ name: "Goal", params: { cid: companyId.value, goalId: goal._id } });

/* Focus goes back to the row the panel was opened from, or to the page's heading when that row has left the list. */
async function closeGoal() {
    const id = openId.value;
    await router.push({ name: "Goals", params: { cid: companyId.value } });
    await nextTick();
    (rowOf(id) || heading.value)?.focus();
}

async function stopCreating() {
    creating.value = false;
    await nextTick();
    (newButton.value || heading.value)?.focus();
}

function created(goal) {
    creating.value = false;
    if (goal) openGoal(goal);
}

watch(openId, (id) => store.dispatch(id ? "goals/open" : "goals/close", id || undefined), { immediate: true });

/* A write can take the open goal out of this person's reach (handing a private goal on): that is a result, not a failure. */
watch(() => open.value.status, (now) => {
    if (now !== "gone" || !openId.value) return;
    toast.info(t("Goals.goal_gone"), TOAST);
    closeGoal();
});

const noteChange = () => store.dispatch("goals/changed");
const onVisible = () => { if (document.visibilityState === "visible") noteChange(); };

let listening = null;
function listenOn(socket) {
    if (listening) listening.off(CHANGED, noteChange);
    listening = socket && typeof socket.on === "function" ? socket : null;
    if (listening) listening.on(CHANGED, noteChange);
}
/* The socket is replaced when the connection is made again. */
watch(() => store.getters["settings/getSocketInstance"], listenOn, { immediate: true });

/* A read can answer with the numbers it has while the server counts again. The goals are then read
   once more COUNT_POLL_MS after the latest answer, whatever brought it, so never more often than
   that; and not for ever, should a count never come in. */
let countTimer = null;
let countPolls = 0;
let leaving = false;
function awaitCounts() {
    clearTimeout(countTimer);
    if (leaving) return;
    if (!store.getters["goals/counting"]) {
        countPolls = 0;
        return;
    }
    if (countPolls >= COUNT_POLL_LIMIT) return;
    countTimer = setTimeout(async () => {
        countPolls += 1;
        await store.dispatch("goals/refresh");
        awaitCounts();
    }, COUNT_POLL_MS);
}
watch(() => [goals.value, open.value.goal], awaitCounts, { immediate: true });

onMounted(() => {
    document.addEventListener("visibilitychange", onVisible);
    store.dispatch("goals/load", { quiet: true });
});
onUnmounted(() => {
    leaving = true;
    clearTimeout(countTimer);
    document.removeEventListener("visibilitychange", onVisible);
    listenOn(null);
    store.dispatch("goals/stopWatching");
    store.dispatch("goals/close");
});
</script>
