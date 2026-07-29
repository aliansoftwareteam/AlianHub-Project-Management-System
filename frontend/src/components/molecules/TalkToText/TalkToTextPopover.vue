<template>
    <div v-if="modelValue" class="ttt__overlay" @click.self="close">
        <!-- No @click.stop here: the overlay's @click.self already ignores inner
             clicks, and stopping propagation would break Select's document-level
             outside-click detection (open dropdowns wouldn't close). -->
        <div class="ttt__panel">
            <div class="ttt__head">
                <span class="ttt__title"><span class="ttt__dot"></span>{{ $t('TalkToText.title') }}</span>
                <span class="ttt__close" @click="close">&#10005;</span>
            </div>

            <!-- STATE: idle — pick mic + start -->
            <template v-if="state === 'idle'">
                <label class="ttt__label">{{ $t('TalkToText.microphone') }}</label>
                <select v-model="selectedDeviceId" class="ttt__input">
                    <option v-if="!devices.length" value="">{{ $t('TalkToText.default_mic') }}</option>
                    <option v-for="(d, i) in devices" :key="d.deviceId || i" :value="d.deviceId">{{ d.label || $t('TalkToText.mic_n', { n: i + 1 }) }}</option>
                </select>
                <div v-if="errorMsg" class="ttt__error">{{ errorMsg }}</div>
                <button class="ttt__btn-record" @click="startRecording">
                    <span class="ttt__rec-dot"></span>{{ $t('TalkToText.start') }}
                </button>
            </template>

            <!-- STATE: recording — timer + cancel/stop -->
            <template v-else-if="state === 'recording'">
                <div class="ttt__recording">
                    <span class="ttt__rec-live"></span>
                    <span class="ttt__timer">{{ formatTime(elapsed) }}</span>
                    <div class="ttt__wave"><span v-for="n in 20" :key="n" class="ttt__bar" :style="{ animationDelay: (n * 0.06) + 's' }"></span></div>
                    <button class="ttt__icon-btn ttt__cancel" :title="$t('TalkToText.cancel')" @click="cancelRecording">&#10005;</button>
                    <button class="ttt__icon-btn ttt__stop" :title="$t('TalkToText.stop')" @click="stopRecording">&#10003;</button>
                </div>
            </template>

            <!-- STATE: transcribing -->
            <template v-else-if="state === 'transcribing'">
                <div class="ttt__loading"><span class="ttt__spinner"></span>{{ $t('TalkToText.transcribing') }}</div>
            </template>

            <!-- STATE: result — playback + text + actions -->
            <template v-else-if="state === 'result'">
                <div class="ttt__complete">{{ errorMsg ? $t('TalkToText.failed') : $t('TalkToText.complete') }}</div>
                <audio v-if="audioUrl" :src="audioUrl" controls class="ttt__audio"></audio>
                <div v-if="errorMsg" class="ttt__error">{{ errorMsg }}</div>
                <div v-else class="ttt__transcript">{{ transcript }}</div>
                <div class="ttt__actions">
                    <template v-if="errorMsg">
                        <button class="ttt__btn-ghost" @click="resetToIdle">{{ $t('TalkToText.record_again') }}</button>
                    </template>
                    <template v-else>
                        <button class="ttt__btn-ghost" @click="copyText">{{ $t('TalkToText.copy') }}</button>
                        <button class="ttt__btn-primary" @click="openCreateTask">+ {{ $t('TalkToText.create_task') }}</button>
                    </template>
                </div>
            </template>

            <!-- STATE: createTask — project + sprint + create -->
            <template v-else-if="state === 'createTask'">
                <label class="ttt__label">{{ $t('TalkToText.task_name') }}</label>
                <input v-model="taskName" class="ttt__input" :maxlength="250" />
                <label class="ttt__label">{{ $t('TalkToText.project') }}</label>
                <SelectComp
                    name="ttt_project"
                    displayKey="ProjectName"
                    v-model="selectedProjectItem"
                    :options="projectOptions"
                    :enableSearch="true"
                    :placeholder="$t('TalkToText.select_project')"
                    @change="onProjectChange"
                >
                    <template #item="{ item }">{{ item.ProjectName }}</template>
                </SelectComp>
                <label class="ttt__label">{{ $t('TalkToText.sprint') }}</label>
                <SelectComp
                    name="ttt_sprint"
                    displayKey="name"
                    v-model="selectedSprintItem"
                    :options="sprintOptions"
                    :enableSearch="true"
                    :disabled="!selectedProjectItem || sprintLoading"
                    :placeholder="sprintLoading ? $t('TalkToText.loading') : $t('TalkToText.select_sprint')"
                >
                    <template #item="{ item }">{{ item.name }}</template>
                </SelectComp>
                <div v-if="errorMsg" class="ttt__error">{{ errorMsg }}</div>
                <div class="ttt__actions">
                    <button class="ttt__btn-ghost" @click="state = 'result'">{{ $t('TalkToText.back') }}</button>
                    <button class="ttt__btn-primary" :disabled="isBusy" @click="createTask">{{ isBusy ? $t('TalkToText.creating') : $t('TalkToText.create') }}</button>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, inject, watch, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { apiRequest, apiRequestWithoutCompnay } from '@/services';
import * as env from '@/config/env';
import taskClass from '@/utils/TaskOperations';
import { storageQueryBuilder, generateFileName } from '@/utils/storageQueryBuild.js';
import { useGetterFunctions, useCustomComposable } from '@/composable';
import { taskPlanPermission } from '@/composable/commonFunction';
import SelectComp from '@/components/molecules/Select/Select.vue';

const props = defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();
const $toast = useToast();
const { getters, dispatch } = useStore();
const { getUser } = useGetterFunctions();
const { makeUniqueId } = useCustomComposable();
const { checkTaskPerSprintPermisssion } = taskPlanPermission();
const companyId = inject('$companyId');
const userId = inject('$userId');

// state: idle | recording | transcribing | result | createTask
const state = ref('idle');
const errorMsg = ref('');
const devices = ref([]);
const selectedDeviceId = ref('');
const elapsed = ref(0);
const transcript = ref('');
const audioUrl = ref('');
const recordedBlob = ref(null); // retained so the clip can be attached to the created task

let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let timer = null;
let cancelled = false;

const MAX_SECONDS = 300; // 5-minute safety cap

// ---- recording ----
function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
}
async function enumerateMics() {
    try {
        const list = await navigator.mediaDevices.enumerateDevices();
        devices.value = (list || []).filter((d) => d.kind === 'audioinput');
        if (devices.value.length && !selectedDeviceId.value) selectedDeviceId.value = devices.value[0].deviceId;
    } catch (e) { /* labels need a permission grant; ignore */ }
}
async function startRecording() {
    errorMsg.value = '';
    if (!navigator.mediaDevices || !window.MediaRecorder) {
        errorMsg.value = t('TalkToText.unsupported');
        return;
    }
    try {
        const audio = selectedDeviceId.value ? { deviceId: { exact: selectedDeviceId.value } } : true;
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio });
        enumerateMics(); // labels are available now
        chunks = [];
        cancelled = false;
        const mime = window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
        mediaRecorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mediaRecorder.onstop = onRecordingStop;
        mediaRecorder.start();
        state.value = 'recording';
        elapsed.value = 0;
        timer = setInterval(() => { elapsed.value += 1; if (elapsed.value >= MAX_SECONDS) stopRecording(); }, 1000);
    } catch (e) {
        errorMsg.value = t('TalkToText.mic_denied');
    }
}
function clearTimer() { if (timer) { clearInterval(timer); timer = null; } }
function stopTracks() {
    if (mediaStream) { mediaStream.getTracks().forEach((tr) => tr.stop()); mediaStream = null; }
}
function stopRecording() { // ✓ confirm → transcribe
    clearTimer();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}
function cancelRecording() { // ✕ discard → back to idle
    cancelled = true;
    clearTimer();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    else resetToIdle();
}
function onRecordingStop() {
    stopTracks();
    const type = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (cancelled) { cancelled = false; resetToIdle(); return; }
    if (!blob || !blob.size) { errorMsg.value = t('TalkToText.no_audio'); state.value = 'idle'; return; }
    revokeAudio();
    recordedBlob.value = blob;
    audioUrl.value = URL.createObjectURL(blob);
    transcribe(blob);
}

// ---- transcription ----
async function transcribe(blob) {
    state.value = 'transcribing';
    errorMsg.value = '';
    transcript.value = '';
    try {
        const fd = new FormData();
        fd.append('file', new File([blob], 'recording.webm', { type: blob.type || 'audio/webm' }));
        const res = await apiRequest('post', env.AI_TRANSCRIBE, fd, 'form');
        const body = res && res.data;
        if (body && body.status && body.data && typeof body.data.text === 'string' && body.data.text) {
            transcript.value = body.data.text;
            taskName.value = body.data.text.slice(0, 250);
        } else {
            errorMsg.value = (body && body.statusText) || t('TalkToText.failed_hint');
        }
    } catch (e) {
        errorMsg.value = (e && e.response && e.response.data && e.response.data.statusText) || t('TalkToText.failed_hint');
    } finally {
        state.value = 'result';
    }
}
async function copyText() {
    try {
        await navigator.clipboard.writeText(transcript.value || '');
        $toast.success(t('TalkToText.copied'), { position: 'top-right' });
    } catch (e) {
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    }
}

// ---- create task (mirrors ConvertNoteToTask.vue) ----
const taskName = ref('');
const selectedProjectItem = ref(null); // the selected project object (SelectComp v-model)
const selectedSprintItem = ref(null);  // the selected sprint object (SelectComp v-model)
const sprintOptions = ref([]);
const sprintLoading = ref(false);
const isBusy = ref(false);
const companyOwner = computed(() => getters['settings/companyOwnerDetail']);
const projectOptions = computed(() => {
    const list = getters['projectData/onlyActiveProjects'];
    const data = list && list.data ? list.data : [];
    return data.filter((p) => Array.isArray(p.taskStatusData) && Array.isArray(p.taskTypeCounts) && p.taskTypeCounts.length);
});
function openCreateTask() {
    errorMsg.value = '';
    if (projectOptions.value.length === 1) {
        selectedProjectItem.value = projectOptions.value[0];
        onProjectChange();
    }
    state.value = 'createTask';
}
function onProjectChange() {
    selectedSprintItem.value = null;
    sprintOptions.value = [];
    const projectId = selectedProjectItem.value && selectedProjectItem.value._id;
    if (!projectId) return;
    sprintLoading.value = true;
    // Mirror the project list's visibility rule (ProjectListing.vue): show only
    // ACTIVE items. deletedStatusKey: 0/undefined = active, 1 = deleted,
    // 2 = archived, 5 = closed. A sprint inside an archived/deleted folder is
    // hidden too, so we load folders and check the parent folder's status.
    Promise.allSettled([
        dispatch('projectData/setSprints', { projectId }),
        dispatch('projectData/setFolders', { projectId }),
    ]).then((results) => {
        const sprints = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
        const foldersLoaded = results[1].status === 'fulfilled' && Array.isArray(results[1].value);
        const folders = foldersLoaded ? results[1].value : [];
        const isActive = (x) => Number((x && x.deletedStatusKey) || 0) === 0;
        const activeFolderIds = new Set(folders.filter(isActive).map((f) => f._id || f.id));
        const folderNameById = {};
        folders.forEach((f) => { folderNameById[f._id || f.id] = f.name; });
        sprintOptions.value = sprints
            .filter(isActive)                                                    // active sprint
            .filter((s) => !s.folderId || !foldersLoaded || activeFolderIds.has(s.folderId)) // active/absent folder
            .map((s) => ({
                id: s._id || s.id,
                name: s.name || '',
                value: s.value,
                folderId: s.folderId || null,
                folderName: s.folderId ? (folderNameById[s.folderId] || s.folderName || '') : '',
            }));
        if (sprintOptions.value.length === 1) selectedSprintItem.value = sprintOptions.value[0];
    }).catch((e) => console.error('TalkToText fetch sprints/folders:', e))
        .finally(() => { sprintLoading.value = false; });
}
// Upload the recorded voice clip to storage and return an attachment object
// (same shape task file/clip attachments use), or null when there's nothing to
// upload or the upload fails. Mirrors TaskDetailTab's attachment upload; a
// failed clip upload must NOT block task creation.
async function uploadRecordedClip(project, sprint) {
    const blob = recordedBlob.value;
    if (!blob || !blob.size) return null;
    try {
        const mime = blob.type || 'audio/webm';
        const fileName = generateFileName('voice-note-' + makeUniqueId(10) + '.webm', env.STORAGE_TYPE);
        const file = new File([blob], fileName, { type: mime });
        const formData = new FormData();
        formData.append('companyId', companyId.value);
        formData.append('path', `Project/${project._id}/Sprint/${sprint.id}/Attachment/${fileName}`);
        formData.append('file', file);
        const res = await apiRequestWithoutCompnay('post', storageQueryBuilder('upload').route, formData, 'form');
        if (!res || !res.data || res.data.status !== true) return null;
        return {
            filename: 'Voice note.webm',
            extension: 'webm',
            size: blob.size,
            id: makeUniqueId(17),
            createdAt: new Date(),
            userId: userId.value,
            type: 'audio', // renders as an audio player, same as recorded clips
            url: res.data.statusText, // non-image upload returns the stored path string
        };
    } catch (e) {
        console.error('TalkToText clip upload:', e);
        return null;
    }
}

function createTask() {
    const name = (taskName.value || '').trim();
    if (name.length < 3 || name.length > 250) { errorMsg.value = t('TalkToText.name_length'); return; }
    const project = selectedProjectItem.value;
    const sprint = selectedSprintItem.value;
    if (!project || !sprint) { errorMsg.value = t('TalkToText.pick_project_sprint'); return; }
    const status = (project.taskStatusData || []).find((x) => x.type === 'default_active');
    const taskType = (project.taskTypeCounts || [])[0];
    if (!status || !taskType) { errorMsg.value = t('TalkToText.project_not_ready'); return; }

    isBusy.value = true;
    checkTaskPerSprintPermisssion(sprint.id).then(async (allowed) => {
        if (!allowed) {
            isBusy.value = false;
            $toast.error(t('Toast.create_task_plan_limit_message').replace('TASK_SPRINT', sprint.name), { position: 'top-right' });
            return;
        }
        const user = getUser(userId.value);
        const userData = { id: user.id, Employee_Name: user.Employee_Name, companyOwnerId: companyOwner.value && companyOwner.value.userId };
        const sprintObj = { id: sprint.id, name: sprint.name, value: sprint.value };
        if (sprint.folderId) { sprintObj.folderId = sprint.folderId; sprintObj.folderName = sprint.folderName; }
        const obj = {
            TaskName: name, TaskKey: '--', AssigneeUserId: [], watchers: [userId.value], DueDate: '', dueDateDeadLine: [],
            TaskType: taskType.value, TaskTypeKey: taskType.key, ParentTaskId: '', ProjectID: project._id, CompanyId: companyId.value,
            status: { text: status.name, key: status.key, value: status.value, type: status.type },
            isParentTask: true, Task_Leader: userId.value, sprintArray: sprintObj, Task_Priority: 'MEDIUM',
            deletedStatusKey: 0, sprintId: sprint.id, statusType: status.type, statusKey: status.key,
        };
        if (sprint.folderId) obj.folderObjId = sprint.folderId;
        // Attach the original voice recording so the assignee can hear the
        // context behind the task. Best-effort: never blocks task creation.
        const audioAttachment = await uploadRecordedClip(project, sprint);
        if (audioAttachment) obj.attachments = [audioAttachment];
        const projectData = { _id: project._id, CompanyId: project.CompanyId, lastTaskId: project.lastTaskId || 0, ProjectName: project.ProjectName, ProjectCode: project.ProjectCode || '' };
        const indexObj = { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 1 };
        taskClass.create({ data: obj, user: userData, projectData, indexObj })
            .then((res) => {
                if (res.status) {
                    $toast.success(t('Toast.task_created_successfully'), { position: 'top-right' });
                    close();
                } else if (res.isUpgrade) {
                    $toast.error(t('Toast.create_task_plan_limit_message').replace('TASK_SPRINT', sprint.name), { position: 'top-right' });
                } else {
                    $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                }
            })
            .catch((e) => { console.error('TalkToText create task:', e); $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' }); })
            .finally(() => { isBusy.value = false; });
    }).catch((e) => { console.error('TalkToText permission:', e); isBusy.value = false; });
}

// ---- lifecycle ----
function revokeAudio() { if (audioUrl.value) { try { URL.revokeObjectURL(audioUrl.value); } catch (e) { /* already revoked */ } audioUrl.value = ''; } }
function resetToIdle() {
    clearTimer(); stopTracks(); revokeAudio();
    chunks = []; cancelled = false; mediaRecorder = null; recordedBlob.value = null;
    transcript.value = ''; errorMsg.value = ''; elapsed.value = 0;
    selectedProjectItem.value = null; selectedSprintItem.value = null; sprintOptions.value = [];
    state.value = 'idle';
}
function close() { resetToIdle(); emit('update:modelValue', false); }

watch(() => props.modelValue, (open) => { if (open) enumerateMics(); else resetToIdle(); });
onBeforeUnmount(() => resetToIdle());
</script>

<style scoped>
.ttt__overlay { position: fixed; inset: 0; z-index: 1000; }
.ttt__panel {
    position: fixed; top: 56px; right: 16px; width: 340px; max-width: calc(100vw - 24px);
    background: #fff; border: 1px solid #ececf1; border-radius: 12px;
    box-shadow: 0 14px 40px rgba(17, 24, 39, 0.22); padding: 14px 16px 16px;
    font-family: inherit;
}
.ttt__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.ttt__title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; color: #171b26; }
.ttt__dot { width: 8px; height: 8px; border-radius: 50%; background: #ff4757; }
.ttt__close { cursor: pointer; color: #9aa0ac; font-size: 14px; }
.ttt__close:hover { color: #e84a4a; }

.ttt__label { display: block; font-size: 12px; font-weight: 600; color: #5b6270; margin: 10px 0 4px; }
.ttt__input { width: 100%; border: 1px solid #e0e0e6; border-radius: 7px; padding: 8px 10px; font-size: 13px; color: #2b2b2b; outline: none; background: #fff; }
.ttt__input:focus { border-color: #2f3990; }
.ttt__error { color: #e84a4a; font-size: 12px; margin-top: 8px; }

/* Enhance the reusable Select's dropdown for THIS popover only (scoped via
   :deep — the shared Select.vue component itself is left untouched). */
.ttt__panel :deep(.select-option-value) {
    border: 1px solid #e6e7ee;
    border-radius: 10px;
    box-shadow: 0 12px 30px rgba(17, 24, 39, 0.16);
    padding: 6px;
    margin-top: 6px;
    overflow: hidden;
}
.ttt__panel :deep(.cutsom-select-search) {
    padding: 2px 2px 8px !important;
}
.ttt__panel :deep(.cutsom-select-search .form-control) {
    height: 34px;
    border: 1px solid #e0e0e6;
    border-radius: 8px;
    font-size: 13px;
    color: #2b2b2b;
}
.ttt__panel :deep(.cutsom-select-search .form-control:focus) {
    border-color: #2f3990;
    box-shadow: 0 0 0 2px rgba(47, 57, 144, 0.12);
}
.ttt__panel :deep(.custom-selectoptions-wrapper) {
    max-height: 210px;
    overflow-y: auto;
}
.ttt__panel :deep(.custom-select-options) {
    padding: 8px 10px;
    margin: 1px 0;
    border-radius: 8px;
    font-size: 13px;
    color: #2b3040;
    transition: background 0.12s ease, color 0.12s ease;
}
.ttt__panel :deep(.custom-select-options:not(.bg-blue):hover) {
    background: #eef0fb;
    color: #2f3990;
}

.ttt__btn-record { width: 100%; margin-top: 14px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: #ff4757; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 700; cursor: pointer; }
.ttt__btn-record:hover { background: #ec3b4b; }
.ttt__rec-dot { width: 9px; height: 9px; border-radius: 50%; background: #fff; }

.ttt__recording { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.ttt__rec-live { width: 10px; height: 10px; border-radius: 50%; background: #ff4757; animation: ttt-pulse 1s infinite; flex-shrink: 0; }
.ttt__timer { font-variant-numeric: tabular-nums; font-weight: 700; color: #171b26; font-size: 14px; }
.ttt__wave { flex: 1; display: flex; align-items: center; gap: 2px; height: 22px; overflow: hidden; }
.ttt__bar { width: 2px; height: 40%; background: #c7cbd6; border-radius: 2px; animation: ttt-wave 0.9s ease-in-out infinite; }
.ttt__icon-btn { width: 30px; height: 30px; border-radius: 50%; border: none; cursor: pointer; font-size: 14px; flex-shrink: 0; }
.ttt__cancel { background: #f0f0f3; color: #6b7280; }
.ttt__stop { background: #2f3990; color: #fff; }

.ttt__loading { display: flex; align-items: center; gap: 10px; padding: 16px 0; font-size: 13px; color: #4b5162; }
.ttt__spinner { width: 16px; height: 16px; border: 2px solid #dfe3fb; border-top-color: #2f3990; border-radius: 50%; animation: ttt-spin 0.7s linear infinite; }

.ttt__complete { font-size: 13px; font-weight: 700; color: #171b26; margin-bottom: 8px; }
.ttt__audio { width: 100%; height: 36px; margin-bottom: 8px; }
.ttt__transcript { font-size: 13px; line-height: 1.5; color: #2b3040; background: #f7f8fb; border: 1px solid #eef0f4; border-radius: 8px; padding: 10px; max-height: 120px; overflow: auto; white-space: pre-wrap; }
.ttt__actions { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.ttt__actions button { flex: 1; }
.ttt__btn-ghost { background: #f0f0f3; border: none; border-radius: 7px; padding: 8px 14px; font-size: 13px; color: #3a3a3a; cursor: pointer; }
.ttt__btn-ghost:hover { background: #e6e7ec; }
.ttt__btn-primary { background: #2f3990; color: #fff; border: none; border-radius: 7px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.ttt__btn-primary:disabled { opacity: 0.6; cursor: default; }

@keyframes ttt-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes ttt-spin { to { transform: rotate(360deg); } }
@keyframes ttt-wave { 0%,100% { height: 30%; } 50% { height: 90%; } }
</style>
