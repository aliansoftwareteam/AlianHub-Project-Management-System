<template>
    <Teleport to="body">
        <div class="mts-backdrop" @click.self="$emit('close')">
            <div class="ah-card mts" role="dialog" aria-modal="true">
                <div class="mts-head">
                    <ShellIcon name="checkSquare" :size="16" />
                    <span class="ah-h3">{{ $t('ChatV2.make_task') }}</span>
                    <button type="button" class="mc-icon-btn" :title="$t('ChatV2.cancel')" @click="$emit('close')"><ShellIcon name="x" :size="15" /></button>
                </div>

                <div v-if="sourceText" class="mts-source">{{ sourceText }}</div>

                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('ChatV2.task_name') }}</span>
                    <input ref="nameField" v-model.trim="name" type="text" class="ah-input" :class="{ 'ah-input--error': errors.name }" maxlength="250" @keydown.enter.prevent="create" />
                    <span v-if="errors.name" class="ah-field__error">{{ errors.name }}</span>
                </label>

                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('ChatV2.project') }}</span>
                    <select v-model="projectId" class="ah-input" :class="{ 'ah-input--error': errors.project }" @change="onProjectChange">
                        <option value="">{{ $t('ChatV2.select_project') }}</option>
                        <option v-for="project in projects" :key="project._id" :value="project._id">{{ project.ProjectName }}</option>
                    </select>
                    <span v-if="errors.project" class="ah-field__error">{{ errors.project }}</span>
                </label>

                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('ChatV2.sprint') }}</span>
                    <select v-model="sprintId" class="ah-input" :disabled="!projectId || sprintLoading">
                        <option value="">{{ sprintLoading ? $t('MainChat.loading') : $t('ChatV2.select_sprint') }}</option>
                        <option v-for="sprint in sprints" :key="sprint.id" :value="sprint.id">{{ sprint.folderName ? `${sprint.folderName} / ${sprint.name}` : sprint.name }}</option>
                    </select>
                </label>

                <p v-if="errors.form" class="ah-field__error">{{ errors.form }}</p>

                <div class="mts-foot">
                    <button type="button" class="ah-btn ah-btn--secondary" @click="$emit('close')">{{ $t('ChatV2.cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary" :disabled="busy" @click="create">{{ busy ? $t('ChatV2.creating') : $t('ChatV2.create') }}</button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
/**
 * Turn a message, a voice note or a meeting action item into a task. The task's
 * description carries the source text and a link back to where it came from.
 */
import { computed, defineProps, defineEmits, inject, nextTick, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import taskClass from '@/utils/TaskOperations';
import { useGetterFunctions } from '@/composable';
import { taskPlanPermission } from '@/composable/commonFunction';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

const props = defineProps({
    initialTitle: { type: String, default: '' },
    sourceText: { type: String, default: '' },
    // Plain-text label + URL of where the task came from; rendered into the description.
    sourceLabel: { type: String, default: '' },
    sourceUrl: { type: String, default: '' },
    defaultProjectId: { type: String, default: '' },
});

const emit = defineEmits(['created', 'close']);

const { t } = useI18n();
const $toast = useToast();
const { getters, dispatch } = useStore();
const { getUser } = useGetterFunctions();
const { checkTaskPerSprintPermisssion } = taskPlanPermission();
const companyId = inject('$companyId');
const userId = inject('$userId');

const nameField = ref(null);
const name = ref(props.initialTitle.slice(0, 250));
const projectId = ref('');
const sprintId = ref('');
const sprints = ref([]);
const sprintLoading = ref(false);
const busy = ref(false);
const errors = ref({ name: '', project: '', form: '' });

const projects = computed(() => {
    const list = getters['projectData/onlyActiveProjects'];
    const data = (list && list.data) || [];
    return data.filter((p) => Array.isArray(p.taskStatusData) && Array.isArray(p.taskTypeCounts) && p.taskTypeCounts.length);
});

const escapeHtml = (text) => String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function onProjectChange() {
    sprintId.value = '';
    sprints.value = [];
    if (!projectId.value) return;
    sprintLoading.value = true;
    try {
        const [sprintRes, folderRes] = await Promise.allSettled([
            dispatch('projectData/setSprints', { projectId: projectId.value }),
            dispatch('projectData/setFolders', { projectId: projectId.value }),
        ]);
        const list = sprintRes.status === 'fulfilled' && Array.isArray(sprintRes.value) ? sprintRes.value : [];
        const folders = folderRes.status === 'fulfilled' && Array.isArray(folderRes.value) ? folderRes.value : [];
        const isActive = (x) => Number((x && x.deletedStatusKey) || 0) === 0;
        const activeFolders = new Set(folders.filter(isActive).map((f) => f._id || f.id));
        const folderName = {};
        folders.forEach((f) => { folderName[f._id || f.id] = f.name; });
        sprints.value = list
            .filter(isActive)
            .filter((s) => !s.folderId || !folders.length || activeFolders.has(s.folderId))
            .map((s) => ({
                id: s._id || s.id,
                name: s.name || '',
                value: s.value,
                folderId: s.folderId || null,
                folderName: s.folderId ? (folderName[s.folderId] || s.folderName || '') : '',
            }));
        if (sprints.value.length === 1) sprintId.value = sprints.value[0].id;
    } catch (error) {
        console.error('MakeTaskSheet: sprints', error);
    } finally {
        sprintLoading.value = false;
    }
}

onMounted(() => {
    const preferred = projects.value.find((p) => String(p._id) === String(props.defaultProjectId));
    if (preferred) projectId.value = preferred._id;
    else if (projects.value.length === 1) projectId.value = projects.value[0]._id;
    if (projectId.value) onProjectChange();
    nextTick(() => nameField.value && nameField.value.focus());
});

function taskUrl(project, sprint, id) {
    const base = `${window.location.origin}${window.location.pathname}#/${companyId.value}/project/${project._id}`;
    return sprint.folderId ? `${base}/fs/${sprint.folderId}/${sprint.id}/${id}` : `${base}/s/${sprint.id}/${id}`;
}

async function create() {
    errors.value = { name: '', project: '', form: '' };
    if (name.value.length < 3 || name.value.length > 250) errors.value.name = t('ChatV2.name_length');
    if (!projectId.value) errors.value.project = t('ChatV2.select_project');
    if (errors.value.name || errors.value.project) return;

    const project = projects.value.find((p) => String(p._id) === String(projectId.value));
    const sprint = sprints.value.find((s) => String(s.id) === String(sprintId.value));
    if (!project || !sprint) {
        errors.value.form = t('ChatV2.pick_both');
        return;
    }
    const status = (project.taskStatusData || []).find((x) => x.type === 'default_active');
    const taskType = (project.taskTypeCounts || [])[0];
    if (!status || !taskType) {
        errors.value.form = t('ChatV2.no_project_ready');
        return;
    }

    busy.value = true;
    try {
        const allowed = await checkTaskPerSprintPermisssion(sprint.id).catch(() => true);
        if (!allowed) {
            errors.value.form = t('Toast.create_task_plan_limit_message').replace('TASK_SPRINT', sprint.name);
            return;
        }
        const me = getUser(userId.value) || {};
        const owner = getters['settings/companyOwnerDetail'];
        const sprintObj = { id: sprint.id, name: sprint.name, value: sprint.value };
        if (sprint.folderId) {
            sprintObj.folderId = sprint.folderId;
            sprintObj.folderName = sprint.folderName;
        }
        const description = [
            props.sourceText ? `<p>${escapeHtml(props.sourceText)}</p>` : '',
            props.sourceUrl ? `<p>${escapeHtml(t('ChatV2.from_chat'))}: <a href="${escapeHtml(props.sourceUrl)}">${escapeHtml(props.sourceLabel || props.sourceUrl)}</a></p>` : '',
        ].join('');
        const data = {
            TaskName: name.value,
            TaskKey: '--',
            AssigneeUserId: [],
            watchers: [userId.value],
            DueDate: '',
            dueDateDeadLine: [],
            TaskType: taskType.value,
            TaskTypeKey: taskType.key,
            ParentTaskId: '',
            ProjectID: project._id,
            CompanyId: companyId.value,
            status: { text: status.name, key: status.key, value: status.value, type: status.type },
            isParentTask: true,
            Task_Leader: userId.value,
            sprintArray: sprintObj,
            Task_Priority: 'MEDIUM',
            deletedStatusKey: 0,
            sprintId: sprint.id,
            statusType: status.type,
            statusKey: status.key,
            description,
        };
        if (sprint.folderId) data.folderObjId = sprint.folderId;

        const result = await taskClass.create({
            data,
            user: { id: me.id || me._id, Employee_Name: me.Employee_Name, companyOwnerId: owner && owner.userId },
            projectData: { _id: project._id, CompanyId: project.CompanyId, lastTaskId: project.lastTaskId || 0, ProjectName: project.ProjectName, ProjectCode: project.ProjectCode || '' },
            indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 1 },
        });

        if (result && result.status && result.id) {
            $toast.success(t('ChatV2.task_created'), { position: 'top-right' });
            emit('created', { id: result.id, name: name.value, url: taskUrl(project, sprint, result.id), project, sprint });
        } else if (result && result.isUpgrade) {
            errors.value.form = t('Toast.create_task_plan_limit_message').replace('TASK_SPRINT', sprint.name);
        } else {
            errors.value.form = t('ChatV2.something_wrong');
        }
    } catch (error) {
        console.error('MakeTaskSheet: create', error);
        errors.value.form = t('ChatV2.something_wrong');
    } finally {
        busy.value = false;
    }
}
</script>
