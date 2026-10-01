<template>
    <section ref="root" class="hc-card hc-mywork">
        <div class="hc-card__head">
            <span class="hc-card__title">{{ $t('Home.my_work') }}</span>
            <button v-for="tab in tabs" :key="tab" type="button" class="hc-tab" :class="{ 'is-active': activeTab === tab }" @click="switchTab(tab)">{{ $t(`Home.${tab}`) }}</button>
        </div>

        <p v-if="work.loading.value && !work.loaded.value" class="hc-loading">{{ $t('Home.loading') }}</p>

        <template v-else-if="activeTab === 'to_do'">
            <div class="hc-group" data-test="mywork-today" tabindex="-1">
                <span>{{ $t('Home.group_today') }}<span class="hc-group__count">{{ groups.today.length }}</span></span>
                <button type="button" class="hc-group__sort" @click="cycleSort">{{ $t('Home.sort', { by: $t(`Home.sort_${work.sortBy.value}`) }) }} · +</button>
            </div>
            <template v-if="groups.today.length">
                <TaskRow v-for="task in groups.today" :key="task._id" v-bind="rowProps(task)" @toggle="$emit('complete', task)" @open="$emit('open', task)" @timer="$emit('timer', task)" @set-date="$emit('set-date', task)" />
            </template>
            <EmptyState
                v-else
                compact
                illustration="tasks"
                data-test="mywork-empty-today"
                :heading-level="2"
                :title="$t('Home.empty_today_title')"
                :action-label="$t('Home.empty_today_action')"
                :sentence="$t('EmptyState.say_today')"
                @action="focusAdd"
            >
                <i18n-t v-if="sampleProject" keypath="Home.empty_today" tag="span">
                    <template #project><button type="button" class="hc-empty-link" @click="$emit('open-project', sampleProject)">{{ sampleProject.ProjectName }}</button></template>
                </i18n-t>
                <template v-else>{{ $t('Home.empty_today_generic') }}</template>
            </EmptyState>
            <form v-if="showAdd || addUsed || !groups.today.length" class="hc-add" @submit.prevent="submitAdd">
                <span class="hc-add__plus">+</span>
                <input ref="addInput" v-model="draft" type="text" :placeholder="$t('Home.add_task_today')" :readonly="adding" :aria-busy="adding ? 'true' : 'false'" maxlength="250" />
                <span v-if="draft.trim().length >= 3" class="hc-add__hint">↵</span>
            </form>

            <template v-if="groups.overdue.length">
                <div class="hc-group hc-group--danger" data-test="mywork-overdue" tabindex="-1"><span>{{ $t('Home.group_overdue') }}<span class="hc-group__count">{{ groups.overdue.length }}</span></span></div>
                <TaskRow v-for="task in groups.overdue" :key="task._id" v-bind="rowProps(task)" @toggle="$emit('complete', task)" @open="$emit('open', task)" @timer="$emit('timer', task)" @set-date="$emit('set-date', task)" />
            </template>

            <template v-if="groups.next.length">
                <div class="hc-group"><span>{{ $t('Home.group_next') }}<span class="hc-group__count">{{ groups.next.length }}</span><template v-if="firstRun && sampleProject"> · {{ $t('Home.from_sample') }}</template></span></div>
                <TaskRow v-for="task in groups.next" :key="task._id" v-bind="rowProps(task)" @toggle="$emit('complete', task)" @open="$emit('open', task)" @timer="$emit('timer', task)" @set-date="$emit('set-date', task)" />
            </template>

            <template v-if="groups.unscheduled.length">
                <div class="hc-group"><span>{{ $t('Home.group_unscheduled') }}<span class="hc-group__count">{{ groups.unscheduled.length }}</span></span></div>
                <TaskRow v-for="task in groups.unscheduled" :key="task._id" v-bind="rowProps(task)" dim @toggle="$emit('complete', task)" @open="$emit('open', task)" @timer="$emit('timer', task)" @set-date="$emit('set-date', task)" />
            </template>
        </template>

        <template v-else-if="activeTab === 'done'">
            <div class="hc-group"><span>{{ $t('Home.group_done') }}<span class="hc-group__count">{{ work.done.value.length }}</span></span></div>
            <p v-if="!work.doneLoaded.value" class="hc-loading">{{ $t('Home.loading') }}</p>
            <EmptyState v-else-if="!work.done.value.length" compact illustration="tasks" data-test="mywork-empty-done" :heading-level="2" :title="$t('Home.empty_done_title')" :message="$t('Home.empty_done')" />
            <TaskRow v-for="task in work.done.value" :key="task._id" v-bind="rowProps(task)" done :timer="false" :draggable="false" @toggle="$emit('reopen', task)" @open="$emit('open', task)" />
        </template>

        <template v-else>
            <div class="hc-group"><span>{{ $t('Home.group_delegated') }}<span class="hc-group__count">{{ work.delegated.value.length }}</span></span></div>
            <EmptyState v-if="!work.delegated.value.length" compact illustration="people" data-test="mywork-empty-delegated" :heading-level="2" :title="$t('Home.empty_delegated_title')" :message="$t('Home.empty_delegated')" />
            <TaskRow v-for="task in work.delegated.value" :key="task._id" v-bind="rowProps(task)" :timer="false" :set-date="false" :draggable="false" @toggle="$emit('complete', task)" @open="$emit('open', task)" />
        </template>
    </section>
</template>

<script setup>
import { computed, defineEmits, defineProps, nextTick, ref } from "vue";
import TaskRow from "./TaskRow.vue";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";

defineOptions({ name: "MyWorkCard" });

const props = defineProps({
    work: { type: Object, required: true },
    trackingId: { type: String, default: "" },
    firstRun: { type: Boolean, default: false },
    sampleProject: { type: Object, default: null },
    showAdd: { type: Boolean, default: false },
    adding: { type: Boolean, default: false }
});
const emit = defineEmits(["complete", "reopen", "open", "timer", "set-date", "add", "open-project"]);

const tabs = ["to_do", "done", "delegated"];
const activeTab = ref("to_do");
const draft = ref("");
const addInput = ref(null);
const root = ref(null);
// Once used, the field stays even after today's list fills, so the next task needs no click.
const addUsed = ref(false);

const groups = computed(() => props.work.groups.value);

function rowProps(task) {
    return {
        task,
        projectName: props.work.projectOf(task)?.ProjectName || "",
        tracking: props.trackingId === task._id
    };
}

function switchTab(tab) {
    activeTab.value = tab;
    if (tab === "done" && !props.work.doneLoaded.value) props.work.fetchDone().catch((e) => console.error(e));
}

function cycleSort() {
    const order = ["priority", "due", "name"];
    const next = order[(order.indexOf(props.work.sortBy.value) + 1) % order.length];
    props.work.setSort(next);
}

function submitAdd() {
    const name = draft.value.trim();
    if (name.length < 3 || props.adding) return;
    addUsed.value = true;
    emit("add", name);
    draft.value = "";
}

const focusAdd = () => addInput.value?.focus();

async function showGroup(name) {
    activeTab.value = "to_do";
    await nextTick();
    const heading = root.value?.querySelector(`[data-test="mywork-${name}"]`);
    if (!heading) return;
    heading.scrollIntoView?.({ block: "nearest" });
    heading.focus();
}

defineExpose({ focusAdd, showGroup });
</script>
