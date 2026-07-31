<!--
    Reminders list panel, opened from the header clock icon. Lists the current
    user's standalone reminders and hosts the create dialog. Talks only to
    Modules/GeneralReminders (/api/v1/general-reminders).
-->
<template>
    <div v-if="modelValue" class="grp__overlay" @click.self="close">
        <div class="grp__panel" @click="openMenuId = null">
            <div class="grp__head">
                <span class="grp__title">{{ $t('Reminders.panel_title') }}</span>
                <div class="grp__headactions">
                    <button type="button" class="grp__add cursor-pointer" @click.stop="openCreate">
                        + {{ $t('Reminders.add') }}
                    </button>
                    <button type="button" class="grp__close cursor-pointer" :aria-label="$t('Reminders.close')" @click="close">&#10005;</button>
                </div>
            </div>

            <!-- Filter -->
            <div class="grp__filters">
                <button
                    v-for="f in filters"
                    :key="f.value"
                    type="button"
                    class="grp__filter cursor-pointer"
                    :class="{ 'is-active': filter === f.value }"
                    @click.stop="setFilter(f.value)"
                >{{ f.label }}</button>
            </div>

            <div v-if="isLoading" class="grp__state">{{ $t('Reminders.loading') }}</div>
            <div v-else-if="!reminders.length" class="grp__state grp__state--empty">{{ $t('Reminders.empty') }}</div>

            <div v-else class="grp__list" @scroll="closeMenu">
                <div
                    v-for="item in reminders"
                    :key="item._id"
                    class="grp__item"
                    :class="{ 'is-done': item.isDone, 'is-overdue': isOverdue(item) }"
                >
                    <button
                        type="button"
                        class="grp__check cursor-pointer"
                        :class="{ 'is-on': item.isDone }"
                        :title="item.isDone ? $t('Reminders.mark_undone') : $t('Reminders.mark_done')"
                        @click.stop="toggleDone(item)"
                    >
                        <svg v-if="item.isDone" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>
                    </button>

                    <div class="grp__main">
                        <div class="grp__itemtitle" :title="item.title">{{ item.title }}</div>
                        <div v-if="item.description" class="grp__itemdesc">{{ item.description }}</div>
                        <div class="grp__meta">
                            <span class="grp__when">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>
                                {{ formatWhen(item.remindAt) }}
                            </span>
                            <span v-if="notifyText(item)" class="grp__notify">{{ notifyText(item) }}</span>
                            <span v-if="item.fired" class="grp__fired">{{ $t('Reminders.sent') }}</span>
                        </div>

                        <!-- Attachments — each opens via a freshly signed storage URL. -->
                        <div v-if="item.attachments && item.attachments.length" class="grp__files">
                            <button
                                v-for="(file, fi) in item.attachments"
                                :key="fi"
                                type="button"
                                class="grp__file cursor-pointer"
                                :title="file.name"
                                :disabled="openingFile === fileKey(item, fi)"
                                @click.stop="openAttachment(item, fi)"
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                <span class="grp__filename">{{ file.name }}</span>
                            </button>
                        </div>
                    </div>

                    <button type="button" class="grp__menubtn cursor-pointer" :title="$t('Reminders.options')" @click.stop="toggleMenu(item, $event)">
                        <img :src="horizontalDots" alt="options" class="vertical-middle">
                    </button>

                    <div v-if="openMenuId === item._id" class="grp__menu" :style="menuStyle" @click.stop>
                        <div class="grp__menuitem" @click="startEdit(item)">{{ $t('Reminders.edit') }}</div>
                        <div class="grp__menuitem" @click="toggleDone(item)">
                            {{ item.isDone ? $t('Reminders.mark_undone') : $t('Reminders.mark_done') }}
                        </div>
                        <div class="grp__sep"></div>
                        <div class="grp__menulabel">{{ $t('Reminders.snooze') }}</div>
                        <div
                            v-for="opt in snoozeOptions"
                            :key="opt.minutes"
                            class="grp__menuitem grp__menuitem--sub"
                            @click="snooze(item, opt.minutes)"
                        >{{ opt.label }}</div>
                        <div class="grp__sep"></div>
                        <div class="grp__menuitem grp__menuitem--danger" @click="remove(item)">{{ $t('Reminders.delete') }}</div>
                    </div>
                </div>
            </div>
        </div>

        <ReminderModal v-model="showCreate" :reminder="editing" @created="onCreated" @updated="onUpdated" />
    </div>
</template>

<script setup>
import { ref, watch, computed, inject, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import { useCustomComposable } from '@/composable';
import * as env from '@/config/env';
import ReminderModal from './ReminderModal.vue';
import horizontalDots from '@/assets/images/svg/horizontalDots.svg';

const props = defineProps({
    modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();
const $toast = useToast();
const { getWasabiImageLink } = useCustomComposable();
const companyId = inject('$companyId', null);

const reminders = ref([]);
const isLoading = ref(false);
const openMenuId = ref(null);
const showCreate = ref(false);
const editing = ref(null);
const openingFile = ref('');
const menuStyle = ref({});
const filter = ref('upcoming');

const snoozeOptions = computed(() => ([
    { minutes: 10, label: t('Reminders.snooze_10m') },
    { minutes: 60, label: t('Reminders.snooze_1h') },
    { minutes: 60 * 24, label: t('Reminders.snooze_1d') },
]));

const filters = computed(() => ([
    { value: 'upcoming', label: t('Reminders.filter_upcoming') },
    { value: 'done', label: t('Reminders.filter_done') },
    { value: 'all', label: t('Reminders.filter_all') },
]));

function close() {
    emit('update:modelValue', false);
}

function setFilter(value) {
    if (filter.value === value) return;
    filter.value = value;
    fetchReminders();
}

// The menu is position:fixed (so the scrolling list can't clip it), which means
// its coordinates are derived from the trigger button. It flips above the button
// when there isn't room below.
const MENU_HEIGHT = 250;
const MENU_WIDTH = 172;

function toggleMenu(item, event) {
    if (openMenuId.value === item._id) {
        openMenuId.value = null;
        return;
    }
    const trigger = event && event.currentTarget;
    if (trigger && trigger.getBoundingClientRect) {
        const rect = trigger.getBoundingClientRect();
        const flipUp = rect.bottom + MENU_HEIGHT > window.innerHeight;
        menuStyle.value = {
            top: flipUp ? `${Math.max(8, rect.top - MENU_HEIGHT)}px` : `${rect.bottom + 4}px`,
            left: `${Math.max(8, rect.right - MENU_WIDTH)}px`,
        };
    }
    openMenuId.value = item._id;
}

// A fixed-position menu doesn't travel with the list, so dismiss it on scroll.
function closeMenu() {
    openMenuId.value = null;
}

function fetchReminders() {
    isLoading.value = true;
    const query = filter.value === 'all' ? '' : `?filter=${filter.value}`;
    apiRequest('get', `${env.GENERAL_REMINDERS}${query}`)
        .then((response) => {
            reminders.value = response.data && response.data.status ? (response.data.data || []) : [];
        })
        .catch((error) => console.error('ERROR in fetch reminders: ', error))
        .finally(() => { isLoading.value = false; });
}

function onCreated() {
    // A new reminder is never complete, so make sure it is visible.
    editing.value = null;
    if (filter.value === 'done') filter.value = 'upcoming';
    fetchReminders();
}

function onUpdated() {
    editing.value = null;
    fetchReminders();
}

function startEdit(item) {
    editing.value = { ...item };
    openMenuId.value = null;
    showCreate.value = true;
}

function openCreate() {
    editing.value = null;
    showCreate.value = true;
}

// --- snooze -------------------------------------------------------------
// Pushes the reminder out by N minutes from now. The API re-arms it
// (fired/isDone cleared) whenever remindAt changes, so a delivered reminder
// becomes active again.
function snooze(item, minutes) {
    const next = new Date(Date.now() + minutes * 60 * 1000);
    apiRequest('patch', `${env.GENERAL_REMINDERS}/${item._id}`, { remindAt: next.toISOString() })
        .then((response) => {
            if (response.data && response.data.status) {
                openMenuId.value = null;
                $toast.success(t('Reminders.snoozed'), { position: 'top-right' });
                fetchReminders();
            } else {
                $toast.error(t('Reminders.update_failed'), { position: 'top-right' });
            }
        })
        .catch((error) => {
            console.error('ERROR in snooze reminder: ', error);
            $toast.error(t('Reminders.update_failed'), { position: 'top-right' });
        });
}

// --- attachments --------------------------------------------------------
// Stored attachments hold a storage KEY, so a signed/presigned URL has to be
// resolved at click time (same helper the rest of the app uses).
function fileKey(item, index) {
    return `${item._id}:${index}`;
}

async function openAttachment(item, index) {
    const file = (item.attachments || [])[index];
    if (!file || !file.url) return;
    const marker = fileKey(item, index);
    openingFile.value = marker;
    try {
        const cid = companyId?.value || companyId;
        const link = await getWasabiImageLink(cid, file.url);
        if (link) {
            window.open(link, '_blank', 'noopener');
        } else {
            $toast.error(t('Reminders.file_open_failed'), { position: 'top-right' });
        }
    } catch (error) {
        console.error('ERROR in open attachment: ', error);
        $toast.error(t('Reminders.file_open_failed'), { position: 'top-right' });
    } finally {
        openingFile.value = '';
    }
}

function toggleDone(item) {
    const next = !item.isDone;
    apiRequest('patch', `${env.GENERAL_REMINDERS}/${item._id}`, { isDone: next })
        .then((response) => {
            if (response.data && response.data.status) {
                item.isDone = next;
                openMenuId.value = null;
                // Drop it from the list when it no longer matches the filter.
                if ((filter.value === 'upcoming' && next) || (filter.value === 'done' && !next)) {
                    fetchReminders();
                }
            } else {
                $toast.error(t('Reminders.update_failed'), { position: 'top-right' });
            }
        })
        .catch((error) => {
            console.error('ERROR in update reminder: ', error);
            $toast.error(t('Reminders.update_failed'), { position: 'top-right' });
        });
}

function remove(item) {
    apiRequest('delete', `${env.GENERAL_REMINDERS}/${item._id}`)
        .then((response) => {
            if (response.data && response.data.status) {
                reminders.value = reminders.value.filter((r) => r._id !== item._id);
                openMenuId.value = null;
                $toast.success(t('Reminders.deleted'), { position: 'top-right' });
            } else {
                $toast.error(t('Reminders.delete_failed'), { position: 'top-right' });
            }
        })
        .catch((error) => {
            console.error('ERROR in delete reminder: ', error);
            $toast.error(t('Reminders.delete_failed'), { position: 'top-right' });
        });
}

// --- display helpers ----------------------------------------------------
function isOverdue(item) {
    if (item.isDone) return false;
    const at = new Date(item.remindAt).getTime();
    return !Number.isNaN(at) && at < Date.now();
}

function formatWhen(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
    if (sameDay(d, today)) return `${t('Reminders.today')}, ${time}`;
    if (sameDay(d, tomorrow)) return `${t('Reminders.tomorrow')}, ${time}`;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
}

function notifyText(item) {
    const lead = Number(item.notifyBefore);
    if (lead === -1) return t('Reminders.dont_notify');
    if (!Number.isFinite(lead) || lead <= 0) return '';
    if (lead === 60) return t('Reminders.one_hour_before');
    return `${lead} ${t('Reminders.minutes_before')}`;
}

// --- real-time sync -----------------------------------------------------
// The panel subscribes to its own user's reminder stream, so create / update /
// delete (including a reminder firing) reflect live across tabs and devices.
const store = useStore();
const userId = inject('$userId', null);
let joinedSocket = null;

function matchesFilter(item) {
    if (!item || Number(item.deletedStatusKey) === 1) return false;
    if (filter.value === 'upcoming') return !item.isDone;
    if (filter.value === 'done') return !!item.isDone;
    return true;
}

function applyRemoteChange(payload) {
    const doc = payload && payload.fullDocument;
    if (!doc || !doc._id) return;
    const id = String(doc._id);
    const idx = reminders.value.findIndex((r) => String(r._id) === id);
    const gone = payload.type === 'delete' || Number(doc.deletedStatusKey) === 1;

    if (gone || !matchesFilter(doc)) {
        if (idx !== -1) reminders.value.splice(idx, 1);
        return;
    }
    if (idx !== -1) {
        reminders.value[idx] = { ...reminders.value[idx], ...doc };
    } else {
        reminders.value.push(doc);
        reminders.value.sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));
    }
}

function bindSocket() {
    const socket = store.getters['settings/getSocketInstance'] || store.state?.settings?.socketInstance;
    const uid = userId?.value || userId;
    if (!socket || !uid || joinedSocket === socket) return;
    joinedSocket = socket;
    socket.emit('joinGeneralReminder', { uid, socketId: socket.id });
    socket.off('generalReminderUpdate');
    socket.on('generalReminderUpdate', applyRemoteChange);
}

onMounted(bindSocket);
onBeforeUnmount(() => {
    if (joinedSocket) joinedSocket.off('generalReminderUpdate', applyRemoteChange);
});

watch(() => props.modelValue, (open) => {
    if (open) {
        openMenuId.value = null;
        showCreate.value = false;
        bindSocket();
        fetchReminders();
    }
});
</script>

<style scoped src="./panel.css"></style>
