<template>
    <section class="hc-card hc-mywork">
        <div class="hc-card__head">
            <span class="hc-card__title">{{ $t('HomeV2.my_work') }}</span>
            <button v-for="tab in tabs" :key="tab" type="button" class="hc-tab" :class="{ 'is-active': activeTab === tab }" @click="switchTab(tab)">{{ $t(`HomeV2.${tab}`) }}</button>
        </div>

        <p v-if="work.loading.value && !work.loaded.value" class="hc-loading">{{ $t('HomeV2.loading') }}</p>

        <template v-else-if="activeTab === 'to_do'">
            <div class="hc-group">
                <span>{{ $t('HomeV2.group_today') }} · {{ groups.today.length }}</span>
                <button type="button" class="hc-group__sort" @click="cycleSort">{{ $t('HomeV2.sort', { by: $t(`HomeV2.sort_${work.sortBy.value}`) }) }} · +</button>
            </div>
            <template v-if="groups.today.length">
                <TaskRow v-for="task in groups.today" :key="task._id" v-bind="rowProps(task)" @toggle="$emit('complete', task)" @open="$emit('open', task)" @timer="$emit('timer', task)" @set-date="$emit('set-date', task)" />
            </template>
            <div v-else class="hc-empty">
                <i18n-t v-if="sampleProject" keypath="HomeV2.empty_today" tag="span">
                    <template #project><button type="button" @click="$emit('open-project', sampleProject)">{{ sampleProject.ProjectName }}</button></template>
                </i18n-t>
                <span v-else>{{ $t('HomeV2.empty_today_generic') }}</span>
            </div>
            <form v-if="showAdd || !groups.today.length" class="hc-add" @submit.prevent="submitAdd">
                <span class="hc-add__plus">+</span>
                <input ref="addInput" v-model="draft" type="text" :placeholder="$t('HomeV2.add_task_today')" :disabled="adding" maxlength="250" />
                <span v-if="draft.trim().length >= 3" class="hc-add__hint">↵</span>
            </form>

            <template v-if="groups.overdue.length">
                <div class="hc-group hc-group--danger"><span>{{ $t('HomeV2.group_overdue') }} · {{ groups.overdue.length }}</span></div>
                <TaskRow v-for="task in groups.overdue" :key="task._id" v-bind="rowProps(task)" @toggle="$emit('complete', task)" @open="$emit('open', task)" @timer="$emit('timer', task)" @set-date="$emit('set-date', task)" />
            </template>

            <template v-if="groups.next.length">
                <div class="hc-group"><span>{{ $t('HomeV2.group_next') }} · {{ groups.next.length }}<template v-if="firstRun"> · {{ $t('HomeV2.from_sample') }}</template></span></div>
                <TaskRow v-for="task in groups.next" :key="task._id" v-bind="rowProps(task)" @toggle="$emit('complete', task)" @open="$emit('open', task)" @timer="$emit('timer', task)" @set-date="$emit('set-date', task)" />
            </template>

            <template v-if="groups.unscheduled.length">
                <div class="hc-group"><span>{{ $t('HomeV2.group_unscheduled') }} · {{ groups.unscheduled.length }}</span></div>
                <TaskRow v-for="task in groups.unscheduled" :key="task._id" v-bind="rowProps(task)" dim @toggle="$emit('complete', task)" @open="$emit('open', task)" @timer="$emit('timer', task)" @set-date="$emit('set-date', task)" />
            </template>
        </template>

        <template v-else-if="activeTab === 'done'">
            <div class="hc-group"><span>{{ $t('HomeV2.group_done') }} · {{ work.done.value.length }}</span></div>
            <p v-if="!work.doneLoaded.value" class="hc-loading">{{ $t('HomeV2.loading') }}</p>
            <div v-else-if="!work.done.value.length" class="hc-empty">{{ $t('HomeV2.empty_done') }}</div>
            <TaskRow v-for="task in work.done.value" :key="task._id" v-bind="rowProps(task)" done :timer="false" :draggable="false" @toggle="$emit('reopen', task)" @open="$emit('open', task)" />
        </template>

        <template v-else>
            <div class="hc-group"><span>{{ $t('HomeV2.group_delegated') }} · {{ work.delegated.value.length }}</span></div>
            <div v-if="!work.delegated.value.length" class="hc-empty">{{ $t('HomeV2.empty_delegated') }}</div>
            <TaskRow v-for="task in work.delegated.value" :key="task._id" v-bind="rowProps(task)" :timer="false" :set-date="false" :draggable="false" @toggle="$emit('complete', task)" @open="$emit('open', task)" />
        </template>
    </section>
</template>

<script setup>
import { computed, defineEmits, defineProps, ref } from "vue";
import TaskRow from "./TaskRow.vue";

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
    if (name.length < 3) return;
    emit("add", name);
    draft.value = "";
}

defineExpose({ focusAdd: () => addInput.value?.focus() });
</script>
