<!--
    General-purpose "Reminder" dialog, opened from the header clock icon.
    Standalone: not tied to a task or project. Talks to Modules/GeneralReminders
    (/api/v1/general-reminders) — completely separate from the task-scoped
    "Remind me" flow in TaskDetailAction.vue.
-->
<template>
    <div v-if="modelValue" class="gr__overlay" @click.self="close">
        <!-- Any click inside the dialog that isn't on a chip or inside a popover
             (both stop propagation) bubbles to here and dismisses the open popover. -->
        <div class="gr__dialog" role="dialog" aria-modal="true" :aria-label="$t('Reminders.title')" @click="openPop = ''">
            <!-- Header -->
            <div class="gr__head">
                <h3 class="gr__title">{{ isEdit ? $t('Reminders.edit_title') : $t('Reminders.title') }}</h3>
                <button type="button" class="gr__close cursor-pointer" :title="$t('Reminders.close')" @click="close">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M18 6L6 18M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <div class="gr__body">
                <!-- Name -->
                <input
                    ref="nameInput"
                    v-model="title"
                    type="text"
                    class="gr__name"
                    maxlength="250"
                    :placeholder="$t('Reminders.name_placeholder')"
                    @keyup.enter="save"
                />

                <!-- Description -->
                <button v-if="!showDescription" type="button" class="gr__adddesc cursor-pointer" @click="openDescription">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path>
                    </svg>
                    {{ $t('Reminders.add_description') }}
                </button>
                <textarea
                    v-else
                    ref="descInput"
                    v-model="description"
                    class="gr__desc"
                    rows="3"
                    :placeholder="$t('Reminders.description_placeholder')"
                ></textarea>

                <!-- Chips -->
                <div class="gr__chips">
                    <!-- Date + time -->
                    <div class="gr__chipwrap">
                        <button type="button" class="gr__chip cursor-pointer" :class="{'is-set': true}" @click.stop="togglePop('date')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path>
                            </svg>
                            {{ dateLabel }}
                        </button>
                        <div v-if="openPop === 'date'" class="gr__pop" @click.stop>
                            <div class="gr__presets">
                                <button type="button" class="gr__preset cursor-pointer" @click="setPreset(0)">{{ $t('Reminders.today') }}</button>
                                <button type="button" class="gr__preset cursor-pointer" @click="setPreset(1)">{{ $t('Reminders.tomorrow') }}</button>
                                <button type="button" class="gr__preset cursor-pointer" @click="setPreset(7)">{{ $t('Reminders.next_week') }}</button>
                            </div>
                            <input v-model="remindAtLocal" type="datetime-local" class="gr__dtinput" :min="minLocal" />
                            <div class="gr__popfoot">
                                <button type="button" class="gr__popdone cursor-pointer" @click="openPop = ''">{{ $t('Reminders.done') }}</button>
                            </div>
                        </div>
                    </div>

                    <!-- Assignee -->
                    <div class="gr__chipwrap">
                        <button type="button" class="gr__chip cursor-pointer" @click.stop="togglePop('who')">
                            <span class="gr__avatar">{{ assigneeInitial }}</span>
                            {{ assigneeLabel }}
                        </button>
                        <div v-if="openPop === 'who'" class="gr__pop gr__pop--list" @click.stop>
                            <button type="button" class="gr__opt cursor-pointer" :class="{'is-sel': !assignedTo}" @click="assignedTo = ''; openPop = ''">
                                {{ $t('Reminders.for_me') }}
                                <svg v-if="!assignedTo" class="gr__tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>
                            </button>
                            <button
                                v-for="user in selectableUsers"
                                :key="user._id"
                                type="button"
                                class="gr__opt cursor-pointer"
                                :class="{'is-sel': assignedTo === user._id}"
                                @click="assignedTo = user._id; openPop = ''"
                            >
                                {{ user.Employee_Name }}
                                <svg v-if="assignedTo === user._id" class="gr__tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Notify me -->
                    <div class="gr__chipwrap">
                        <button type="button" class="gr__chip cursor-pointer" @click.stop="togglePop('notify')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.7 21a2 2 0 0 1-3.4 0"></path>
                            </svg>
                            {{ notifyLabel }}
                        </button>
                        <div v-if="openPop === 'notify'" class="gr__pop gr__pop--list" @click.stop>
                            <div class="gr__poptitle">{{ $t('Reminders.notify_me') }}</div>
                            <button
                                v-for="opt in notifyOptions"
                                :key="opt.value"
                                type="button"
                                class="gr__opt cursor-pointer"
                                :class="{'is-sel': notifyBefore === opt.value && !customOpen}"
                                @click="pickNotify(opt.value)"
                            >
                                {{ opt.label }}
                                <svg v-if="notifyBefore === opt.value && !customOpen" class="gr__tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>
                            </button>
                            <button type="button" class="gr__opt cursor-pointer" :class="{'is-sel': customOpen}" @click="customOpen = true">
                                {{ $t('Reminders.custom') }}
                            </button>
                            <div v-if="customOpen" class="gr__custom">
                                <input v-model.number="customMinutes" type="number" min="1" max="10080" class="gr__custominput" />
                                <span>{{ $t('Reminders.minutes_before') }}</span>
                                <button type="button" class="gr__popdone cursor-pointer" @click="applyCustom">{{ $t('Reminders.apply') }}</button>
                            </div>
                            <div class="gr__sep"></div>
                            <button type="button" class="gr__opt cursor-pointer" :class="{'is-sel': notifyBefore === -1}" @click="pickNotify(-1)">
                                {{ $t('Reminders.dont_notify') }}
                                <svg v-if="notifyBefore === -1" class="gr__tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Attachments -->
                <div v-if="showAttachments" class="gr__attach">
                    <div class="gr__attachhead">{{ $t('Reminders.attachments') }}</div>
                    <div v-for="(file, i) in attachments" :key="i" class="gr__file">
                        <svg class="gr__fileok" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>
                        <span class="gr__filename" :title="file.name">{{ file.name }}</span>
                        <button type="button" class="gr__filex cursor-pointer" :title="$t('Reminders.remove')" @click="removeFile(i)">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div class="gr__drop" @dragover.prevent @drop.prevent="onDrop">
                        {{ $t('Reminders.drag_files') }}
                        <label class="gr__browse cursor-pointer">
                            {{ $t('Reminders.browse') }}
                            <input type="file" multiple class="gr__hiddenfile" @change="onPick" />
                        </label>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="gr__foot">
                <button type="button" class="gr__clip cursor-pointer" :class="{'is-on': showAttachments}" :title="$t('Reminders.attach')" @click="showAttachments = !showAttachments">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                    </svg>
                </button>
                <button type="button" class="gr__create cursor-pointer" :disabled="!canSave" @click="save">
                    {{ uploading ? $t('Reminders.uploading') : (saving ? $t('Reminders.creating') : (isEdit ? $t('Reminders.save') : $t('Reminders.create'))) }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, inject, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest, apiRequestWithoutCompnay } from '@/services';
import { storageQueryBuilder, generateFileName } from '@/utils/storageQueryBuild.js';
import * as env from '@/config/env';

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    // When supplied the dialog edits that reminder instead of creating one.
    reminder: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue', 'created', 'updated']);

const isEdit = computed(() => !!(props.reminder && props.reminder._id));

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const userId = inject('$userId', null);
const companyId = inject('$companyId', null);

const title = ref('');
const description = ref('');
const showDescription = ref(false);
const assignedTo = ref('');
const notifyBefore = ref(0);
const attachments = ref([]);
const showAttachments = ref(false);
const saving = ref(false);
const uploading = ref(false);
const openPop = ref('');
const customOpen = ref(false);
const customMinutes = ref(30);
const nameInput = ref(null);
const descInput = ref(null);

// --- date helpers -------------------------------------------------------
// The <input type="datetime-local"> works in local time, so we keep the value
// as a `YYYY-MM-DDTHH:mm` string and only convert to ISO when saving.
function toLocalInput(date) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultWhen() {
    const d = new Date();
    d.setHours(d.getHours() + 1, d.getMinutes(), 0, 0);
    return toLocalInput(d);
}
const remindAtLocal = ref(defaultWhen());
const minLocal = computed(() => toLocalInput(new Date()));

const dateLabel = computed(() => {
    if (!remindAtLocal.value) return t('Reminders.set_date');
    const d = new Date(remindAtLocal.value);
    if (Number.isNaN(d.getTime())) return t('Reminders.set_date');
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
    if (sameDay(d, today)) return `${t('Reminders.today')}, ${time}`;
    if (sameDay(d, tomorrow)) return `${t('Reminders.tomorrow')}, ${time}`;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
});

function setPreset(daysFromToday) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    d.setHours(9, 0, 0, 0);
    // Keep a "today" preset in the future.
    if (daysFromToday === 0 && d.getTime() < Date.now()) {
        const now = new Date();
        now.setHours(now.getHours() + 1, now.getMinutes(), 0, 0);
        remindAtLocal.value = toLocalInput(now);
        return;
    }
    remindAtLocal.value = toLocalInput(d);
}

// --- assignee -----------------------------------------------------------
const allUsers = computed(() => getters['users/users'] || []);
const selectableUsers = computed(() => allUsers.value.filter((u) => u && u._id && u._id !== (userId?.value || userId)));
const assigneeLabel = computed(() => {
    if (!assignedTo.value) return t('Reminders.for_me');
    const u = allUsers.value.find((x) => x._id === assignedTo.value);
    return u ? u.Employee_Name : t('Reminders.for_me');
});
const assigneeInitial = computed(() => {
    const label = assigneeLabel.value || '';
    return label === t('Reminders.for_me') ? t('Reminders.me_initial') : label.charAt(0).toUpperCase();
});

// --- notify -------------------------------------------------------------
const notifyOptions = computed(() => ([
    { value: 0, label: t('Reminders.on_due_date') },
    { value: 10, label: t('Reminders.ten_minutes_before') },
    { value: 60, label: t('Reminders.one_hour_before') },
]));
const notifyLabel = computed(() => {
    if (notifyBefore.value === -1) return t('Reminders.dont_notify');
    const preset = notifyOptions.value.find((o) => o.value === notifyBefore.value);
    if (preset) return notifyBefore.value === 0 ? t('Reminders.notify_me') : preset.label;
    return `${notifyBefore.value} ${t('Reminders.minutes_before')}`;
});
function pickNotify(value) {
    notifyBefore.value = value;
    customOpen.value = false;
    openPop.value = '';
}
function applyCustom() {
    const mins = Number(customMinutes.value);
    if (Number.isFinite(mins) && mins > 0) notifyBefore.value = Math.floor(mins);
    customOpen.value = false;
    openPop.value = '';
}

// --- attachments --------------------------------------------------------
function addFiles(fileList) {
    Array.from(fileList || []).forEach((f) => {
        if (attachments.value.length >= 20) return;
        attachments.value.push({
            name: f.name,
            size: f.size,
            extension: f.name.includes('.') ? f.name.split('.').pop() : '',
            url: '',
            // The real File is kept only client-side; it is uploaded on save and
            // stripped from the payload afterwards.
            file: f,
        });
    });
}

// Upload every picked file through the app's existing storage endpoint
// (server or wasabi, chosen by storageQueryBuilder) and return the attachment
// records with their storage keys filled in. Mirrors ClipRecorder.vue.
async function uploadAttachments() {
    const cid = companyId?.value || companyId;
    const uid = userId?.value || userId;
    const uploaded = [];
    for (const att of attachments.value) {
        if (!att.file) {
            // Already uploaded (or metadata-only) — keep as-is.
            uploaded.push({ name: att.name, size: att.size, extension: att.extension, url: att.url });
            continue;
        }
        const storedName = generateFileName(att.name, env.STORAGE_TYPE);
        const formData = new FormData();
        // Order matters: server storage's multer reads companyId/path from the
        // stream before the file, so these must be appended first.
        formData.append('companyId', cid);
        formData.append('path', `Reminders/${cid}/${uid}/${storedName}`);
        formData.append('file', att.file);
        const res = await apiRequestWithoutCompnay('post', storageQueryBuilder('upload').route, formData, 'form');
        if (!res || !res.data || res.data.status !== true) {
            throw new Error((res && res.data && res.data.statusText) || 'upload failed');
        }
        // No thumbnail `key` is sent, so statusText is always the stored key string.
        uploaded.push({
            name: att.name,
            size: att.size,
            extension: att.extension,
            url: res.data.statusText,
        });
    }
    return uploaded;
}
function onPick(e) {
    addFiles(e.target.files);
    e.target.value = '';
}
function onDrop(e) {
    addFiles(e.dataTransfer && e.dataTransfer.files);
}
function removeFile(i) {
    attachments.value.splice(i, 1);
}

// --- open / close / save ------------------------------------------------
function togglePop(which) {
    openPop.value = openPop.value === which ? '' : which;
}
function openDescription() {
    showDescription.value = true;
    nextTick(() => descInput.value && descInput.value.focus());
}
function reset() {
    const src = props.reminder;
    if (src && src._id) {
        // Edit mode — prefill from the reminder being edited.
        title.value = src.title || '';
        description.value = src.description || '';
        showDescription.value = !!(src.description && String(src.description).trim());
        assignedTo.value = '';
        notifyBefore.value = Number.isFinite(Number(src.notifyBefore)) ? Number(src.notifyBefore) : 0;
        // Existing attachments carry a storage url and no File — uploadAttachments
        // passes those through untouched.
        attachments.value = Array.isArray(src.attachments) ? src.attachments.map((a) => ({ ...a })) : [];
        showAttachments.value = !!attachments.value.length;
        remindAtLocal.value = src.remindAt ? toLocalInput(src.remindAt) : defaultWhen();
    } else {
        title.value = '';
        description.value = '';
        showDescription.value = false;
        assignedTo.value = '';
        notifyBefore.value = 0;
        attachments.value = [];
        showAttachments.value = false;
        remindAtLocal.value = defaultWhen();
    }
    openPop.value = '';
    customOpen.value = false;
    customMinutes.value = 30;
    saving.value = false;
    uploading.value = false;
}
function close() {
    emit('update:modelValue', false);
}

const canSave = computed(() => !!title.value.trim() && !!remindAtLocal.value && !saving.value);

async function save() {
    if (!canSave.value) return;
    const when = new Date(remindAtLocal.value);
    if (Number.isNaN(when.getTime())) {
        $toast.error(t('Reminders.invalid_date'), { position: 'top-right' });
        return;
    }
    saving.value = true;
    try {
        // Files must land in storage before the reminder is created, so the
        // stored attachment records carry a real key.
        let uploaded = [];
        if (attachments.value.length) {
            uploading.value = true;
            try {
                uploaded = await uploadAttachments();
            } catch (uploadError) {
                console.error('ERROR in upload reminder attachments: ', uploadError);
                $toast.error(t('Reminders.upload_failed'), { position: 'top-right' });
                uploading.value = false;
                saving.value = false;
                return;
            }
            uploading.value = false;
        }
        const payload = {
            title: title.value.trim(),
            description: description.value,
            remindAt: when.toISOString(),
            notifyBefore: notifyBefore.value,
            attachments: uploaded,
            userId: userId?.value || userId,
        };
        if (assignedTo.value) payload.assignedTo = assignedTo.value;
        const res = isEdit.value
            ? await apiRequest('patch', `${env.GENERAL_REMINDERS}/${props.reminder._id}`, payload)
            : await apiRequest('post', env.GENERAL_REMINDERS, payload);
        if (res && res.data && res.data.status) {
            $toast.success(t(isEdit.value ? 'Reminders.updated' : 'Reminders.created'), { position: 'top-right' });
            emit(isEdit.value ? 'updated' : 'created', res.data.data);
            reset();
            close();
        } else {
            $toast.error((res && res.data && res.data.statusText) || t('Reminders.failed'), { position: 'top-right' });
            saving.value = false;
        }
    } catch (error) {
        console.error('ERROR in create reminder: ', error);
        $toast.error(t('Reminders.failed'), { position: 'top-right' });
        saving.value = false;
    }
}

// Escape dismisses an open popover first, then the dialog itself.
function onKeydown(e) {
    if (e.key !== 'Escape') return;
    if (openPop.value) {
        openPop.value = '';
        return;
    }
    close();
}

// Reset each time the dialog is opened, and focus the name field. The key
// listener only lives while the dialog is open.
watch(() => props.modelValue, (open) => {
    if (open) {
        reset();
        document.addEventListener('keydown', onKeydown);
        nextTick(() => nameInput.value && nameInput.value.focus());
    } else {
        document.removeEventListener('keydown', onKeydown);
    }
});

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<style scoped src="./style.css"></style>
