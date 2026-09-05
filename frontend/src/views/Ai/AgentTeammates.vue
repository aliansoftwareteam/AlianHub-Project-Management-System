<template>
    <div class="ah-page parity-page">
        <AiSidebar />
        <div class="parity-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Parity.teammates_title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <router-link class="ah-btn ah-btn--secondary ah-btn--sm" :to="{ name: 'AgentRouting', params: { cid: companyId } }">
                    {{ $t('Parity.bulk_route') }}
                </router-link>
            </div>

            <div class="parity-page__body ah-scroll">
                <p class="parity-lead">{{ $t('Parity.teammates_lead') }}</p>

                <div v-if="loading" class="ah-empty">{{ $t('Parity.loading') }}</div>
                <EmptyState v-else-if="loadError" :title="$t('Ai.load_failed')" :message="loadError" :action-label="$t('Ai.retry')" @action="load" />

                <div v-else class="parity-grid">
                    <section class="ah-card">
                        <div class="ah-card__head">
                            <span class="ah-h3">{{ $t('Parity.assign_to_agent') }}</span>
                            <span v-if="task" class="parity-count">{{ task.TaskKey || '' }}</span>
                        </div>
                        <div class="ah-card__body">
                            <div class="ah-field">
                                <label class="ah-field__label" for="task-find">{{ $t('Parity.find_task') }}</label>
                                <input id="task-find" v-model="taskQuery" class="ah-input" type="search" :placeholder="$t('Parity.find_task_hint')" @keyup.enter="findTasks" />
                            </div>

                            <p v-if="searchError" class="ah-field__error" style="margin-top:8px">{{ searchError }}</p>
                            <div v-else-if="taskResults.length" class="ah-pop" style="margin-top:8px">
                                <button v-for="found in taskResults" :key="found._id" type="button" class="ah-pop__item" @click="chooseTask(found)">
                                    <span class="ah-mono">{{ found.TaskKey || '—' }}</span><span>{{ found.TaskName }}</span>
                                </button>
                            </div>
                            <p v-else-if="searched && !task" class="ah-empty" style="margin-top:8px">{{ $t('Parity.no_tasks_found') }}</p>

                            <div v-if="task" style="margin-top:14px">
                                <div class="ah-label">{{ $t('Parity.what_happens') }}</div>
                                <p class="parity-lead" style="margin-top:6px">{{ $t('Parity.what_happens_body') }}</p>

                                <AgentMentionBox
                                    :agents="agents"
                                    :busy="mentionBusy"
                                    :error="mentionError"
                                    style="margin-top:12px"
                                    @send="onMention"
                                />

                                <div v-if="thread.length" class="mention__thread" style="margin-top:14px">
                                    <div v-for="(msg, i) in thread" :key="i" class="mention__msg">
                                        <span class="ah-avatar">{{ msg.initial }}</span>
                                        <span class="mention__msg-body">
                                            <span class="mention__who">{{ msg.who }}</span><span class="mention__time ah-mono">{{ msg.at }}</span><br />
                                            <template v-for="(part, p) in msg.parts" :key="p">
                                                <span v-if="part.mention" class="mention__at">{{ part.text }}</span>
                                                <span v-else>{{ part.text }}</span>
                                            </template>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <p v-else class="ah-empty" style="margin-top:12px">{{ $t('Parity.pick_a_task') }}</p>
                        </div>
                    </section>

                    <section class="ah-card">
                        <div class="ah-card__head">
                            <span class="ah-h3">{{ $t('Parity.members') }}</span>
                            <span class="parity-count">{{ $t('Parity.people_agents', { p: people.length, a: agents.length }) }}</span>
                        </div>
                        <div class="ah-card__body" style="padding-top:10px">
                            <div class="ah-tabs" style="margin-bottom:10px">
                                <button v-for="tab in tabs" :key="tab" type="button" class="ah-tab" :class="{ 'is-active': view === tab }" @click="view = tab">
                                    {{ $t(`Parity.tab_${tab}`) }}
                                </button>
                            </div>

                            <div class="parity-table">
                                <div class="member-row member-row__head">
                                    <span>{{ $t('Parity.col_member') }}</span>
                                    <span>{{ $t('Parity.col_role') }}</span>
                                    <span>{{ $t('Parity.col_access') }}</span>
                                    <span>{{ $t('Parity.col_active') }}</span>
                                </div>

                                <template v-if="view !== 'agents'">
                                    <div v-for="person in people" :key="person.id" class="member-row">
                                        <span class="member-row__person">
                                            <span class="ah-avatar">{{ person.name.slice(0, 1).toUpperCase() }}</span>
                                            <span>
                                                <strong>{{ person.name }}</strong>
                                                <span class="member-row__mail">{{ person.email }}</span>
                                            </span>
                                        </span>
                                        <span class="member-row__role">{{ roleName(person.roleType) }}</span>
                                        <span class="member-row__access">{{ $t('Parity.everything') }}</span>
                                        <span class="member-row__active ah-mono">{{ person.status }}</span>
                                    </div>
                                </template>

                                <template v-if="view !== 'people'">
                                    <AgentMemberRow
                                        v-for="agent in agents"
                                        :key="agent._id"
                                        :agent="agent"
                                        :owner-name="ownerNameOf(agent)"
                                        :last-active="lastActiveOf(agent)"
                                    />
                                </template>

                                <p v-if="!people.length && !agents.length" class="ah-empty">{{ $t('Parity.no_members') }}</p>
                            </div>

                            <p class="parity-lead" style="margin-top:10px">{{ $t('Parity.no_seat') }}</p>
                        </div>
                    </section>
                </div>

                <section v-if="task && !loading && !loadError" class="ah-card" style="padding:0;overflow:hidden">
                    <div class="ah-card__head">
                        <span class="ah-h3">{{ $t('Parity.picker_title') }}</span>
                        <span class="parity-count">{{ $t('Parity.picker_note') }}</span>
                    </div>
                    <AgentPicker
                        :task="task"
                        :agents="agents"
                        :people="people"
                        :runs="runs"
                        :registry-actions="registryManifest.actions || []"
                        :never="registryManifest.never || []"
                        :busy="assignBusy"
                        :error="assignError"
                        @assign="onAssign"
                        @close="task = null"
                    />
                </section>

                <AgentOutcomes v-if="!loading && !loadError" :runs="runs" :agents="agents" :declines="declines" :stopping="stopping" @stop="onStop" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useGetterFunctions } from "@/composable";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import AiSidebar from "./AiSidebar.vue";
import AgentMemberRow from "./AgentMemberRow.vue";
import AgentMentionBox from "./AgentMentionBox.vue";
import AgentPicker from "./AgentPicker.vue";
import AgentOutcomes from "./AgentOutcomes.vue";
import { useParity } from "./useParity";
import { reasonOf } from "./useAgents";

// Agents as teammates (13b): they appear in Members with an AGENT tag, they can
// be @mentioned into a run, and assigning one states its scope and limits first.
defineOptions({ name: "AgentTeammates" });

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const companyId = inject("$companyId");
const userId = inject("$userId");
const { agents, registryManifest, runs, loadAgents, loadRegistry, loadRuns, startRun, stopRun } = useParity();

const ROLE_NAMES = { 1: "owner", 2: "admin" };
const tabs = ["all", "people", "agents"];
const view = ref("all");
const people = ref([]);
const task = ref(null);
const taskQuery = ref("");
const taskResults = ref([]);
const searched = ref(false);
const thread = ref([]);
const mentionBusy = ref(false);
const mentionError = ref("");
const assignBusy = ref(false);
const assignError = ref("");
const stopping = ref("");
const declines = ref([]);
const loading = ref(true);
const loadError = ref("");
const searchError = ref("");

const projectNameOf = (projectId) => ((getters["projectData/projects"]?.data || []).find((p) => String(p._id) === String(projectId)) || {}).ProjectName || "";
const me = computed(() => getUser(userId.value) || {});

const roleName = (roleType) => t(`Parity.role_${ROLE_NAMES[Number(roleType)] || "member"}`);

const ownerNameOf = (agent) => {
    const owner = people.value.find((p) => p.id === String(agent.ownerId || ""));
    return owner ? owner.name : "";
};

const lastActiveOf = (agent) => {
    const last = runs.value.find((r) => String(r.agentId) === String(agent._id));
    if (!last) return "";
    return new Date(last.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/* Split a comment so the @mention can be tinted without handing raw text to v-html. */
const mentionParts = (body) => String(body).split(/(@[\w-]+)/).filter(Boolean).map((text) => ({ text, mention: text.startsWith("@") }));

const findTasks = async () => {
    searched.value = true;
    searchError.value = "";
    if (taskQuery.value.trim().length < 2) { taskResults.value = []; return; }
    try {
        const res = await apiRequest("post", env.GLOBAL_SEARCH, { query: taskQuery.value.trim() });
        taskResults.value = res?.data?.status ? (res.data.data.tasks || []) : [];
    } catch (error) {
        taskResults.value = [];
        searchError.value = reasonOf(error, "Ai.load_failed");
    }
};

const chooseTask = (found) => {
    task.value = found;
    taskResults.value = [];
    thread.value = [];
    assignError.value = "";
};

const onMention = async ({ body, agent }) => {
    mentionError.value = "";
    thread.value.push({
        who: t("Parity.you"),
        initial: "•",
        at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        parts: mentionParts(body)
    });
    if (!agent) return;
    mentionBusy.value = true;
    try {
        await startRun({ agentId: agent._id, taskId: task.value._id, note: body, trigger: "mention" });
        $toast.success(t("Parity.run_started", { name: agent.name }), { position: "top-right" });
    } catch (error) {
        mentionError.value = error.message;
        declines.value = [{ agentName: agent.name, reason: error.message }, ...declines.value].slice(0, 3);
    } finally {
        mentionBusy.value = false;
    }
};

/* The same PATCH the task panel's assignee control sends, so the history row,
 * the notification and the watcher update all happen. */
const assignPerson = async (personId) => {
    const person = people.value.find((p) => p.id === personId) || {};
    const res = await apiRequest("patch", env.V2_TASKS, {
        action: "updateAssignee",
        firebaseObj: { AssigneeUserId: personId },
        projectData: { _id: task.value.ProjectID, CompanyId: companyId.value, ProjectName: projectNameOf(task.value.ProjectID) },
        taskData: { _id: task.value._id, TaskName: task.value.TaskName, sprintId: task.value.sprintId, folderObjId: task.value.folderObjId || "", AssigneeUserId: task.value.AssigneeUserId || [] },
        employeeName: person.name || "",
        type: "assigneeAdd",
        isUpdateTask: true,
        userData: { Employee_Name: me.value.Employee_Name, id: userId.value, companyOwnerId: getters["settings/companyOwnerDetail"]?.userId }
    });
    if (!res?.data?.status) throw new Error(res?.data?.statusText || t("Parity.assign_failed"));
    task.value = { ...task.value, AssigneeUserId: [...new Set([...(task.value.AssigneeUserId || []), personId])] };
};

const onAssign = async ({ kind, id, fit, notifyMe, stopOverCap, capUsd }) => {
    assignError.value = "";
    assignBusy.value = true;
    try {
        if (kind !== "agent") {
            await assignPerson(id);
            $toast.success(t("Parity.person_assigned"), { position: "top-right" });
            return;
        }
        await startRun({ agentId: id, taskId: task.value._id, trigger: "assignment", note: fit ? fit.reason : "", notifyMe, spendCapUsd: stopOverCap ? capUsd : 0 });
        $toast.success(t("Parity.run_started", { name: fit ? fit.name : "" }), { position: "top-right" });
    } catch (error) {
        assignError.value = reasonOf(error, "Parity.assign_failed");
        if (kind === "agent") declines.value = [{ agentName: fit ? fit.name : "", reason: assignError.value }, ...declines.value].slice(0, 3);
    } finally {
        assignBusy.value = false;
    }
};

const onStop = async (run) => {
    stopping.value = run._id;
    try {
        await stopRun(run._id);
        $toast.success(t("Parity.run_stopped"), { position: "top-right" });
    } catch (error) {
        $toast.error(error.message, { position: "top-right" });
    } finally {
        stopping.value = "";
    }
};

const loadPeople = async () => {
    const res = await apiRequest("get", env.AGENT_TEAM);
    if (res?.data?.status) people.value = res.data.data.people || [];
};

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        await Promise.all([loadAgents(), loadRegistry(), loadRuns(), loadPeople()]);
    } catch (error) {
        loadError.value = reasonOf(error, "Ai.load_failed");
    } finally {
        loading.value = false;
    }
};

onMounted(load);
</script>

<style>
@import "./parity.css";
</style>
