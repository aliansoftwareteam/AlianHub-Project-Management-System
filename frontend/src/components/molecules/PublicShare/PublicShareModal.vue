<template>
    <div v-if="modelValue" class="pshare__back" @click.self="close">
        <div ref="dialogEl" class="ah-card pshare__card" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
            <div class="ah-card__head pshare__head">
                <h3 :id="titleId" class="ah-h3">{{ $t('Projects.public_link') }}</h3>
                <button type="button" class="pshare__close" :title="$t('Projects.close')" :aria-label="$t('Projects.close')" @click="close">
                    <ShellIcon name="x" :size="15" />
                </button>
            </div>
            <div class="ah-card__body pshare__body">
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Projects.select_sprint') }}</span>
                    <select v-model="selectedSprintId" class="ah-input pshare__select">
                        <option v-for="sprint in sprintOptions" :key="sprint.id" :value="sprint.id">{{ sprint.label }}</option>
                    </select>
                </label>
                <button v-if="selectedSprintId" type="button" class="ah-btn ah-btn--ghost ah-btn--sm pshare__who" @click="showWhoCanSee = true">
                    <ShellIcon name="eye" :size="13" />{{ $t('WhoCanSee.menu_sprint') }}
                </button>
                <WhoCanSeeModal v-if="showWhoCanSee" v-model="showWhoCanSee" kind="sprint" :itemId="selectedSprintId" :title="selectedSprintName" />

                <template v-if="share">
                    <div class="pshare__linkrow">
                        <input class="ah-input pshare__link" :value="shareUrl" :aria-label="$t('Projects.public_link')" readonly @focus="$event.target.select()" />
                        <button type="button" class="ah-btn ah-btn--primary" @click="copyLink">{{ $t('Projects.copy_link') }}</button>
                    </div>
                    <div class="pshare__toggles">
                        <label class="pshare__toggle">
                            <input type="checkbox" class="ah-check" :checked="share.enabled" @change="updateShare({ enabled: $event.target.checked })" />
                            <span>{{ $t('Projects.link_enabled') }}</span>
                        </label>
                        <label class="pshare__toggle">
                            <input type="checkbox" class="ah-check" :checked="share.allowIntake" @change="updateShare({ allowIntake: $event.target.checked })" />
                            <span>{{ $t('Projects.allow_intake') }}</span>
                        </label>
                    </div>
                    <div class="pshare__meta">
                        <span v-if="share.hasPassword" class="pshare__fact"><ShellIcon name="lock" :size="12" />{{ $t('Projects.password_protected') }}</span>
                        <span v-if="share.expiresAt" class="pshare__fact"><span>{{ $t('Projects.share_expires_on') }}</span><span>{{ formatDate(share.expiresAt) }}</span></span>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm pshare__delete" @click="deleteShare">
                            <ShellIcon name="trash" :size="13" />{{ $t('Projects.delete_link') }}
                        </button>
                    </div>

                    <section v-if="share.allowIntake" class="pshare__intake">
                        <h4 class="ah-h3 pshare__intake-head">{{ $t('Projects.intake_inbox') }}<span class="ah-chip ah-chip--sm">{{ intakeItems.length }}</span></h4>
                        <p v-if="!intakeItems.length" class="ah-small pshare__none">{{ $t('Projects.no_intake') }}</p>
                        <div v-for="item in intakeItems" :key="item._id" class="pshare__intake-row">
                            <div class="pshare__intake-title">{{ item.title }}</div>
                            <div v-if="item.description" class="ah-small pshare__intake-desc">{{ item.description }}</div>
                            <div class="pshare__intake-foot">
                                <span class="ah-small pshare__intake-from"><span>{{ item.name || $t('Projects.anonymous') }}</span><span v-if="item.email">{{ item.email }}</span></span>
                                <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="review(item, 'accept')">{{ $t('Projects.accept') }}</button>
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="review(item, 'reject')">{{ $t('Projects.reject') }}</button>
                            </div>
                        </div>
                    </section>
                </template>
                <div v-else class="pshare__create">
                    <label class="ah-field">
                        <span class="ah-field__label">{{ $t('Projects.expires_optional') }}</span>
                        <input v-model="newExpiry" type="date" class="ah-input" />
                    </label>
                    <label class="ah-field">
                        <span class="ah-field__label">{{ $t('Projects.password_optional') }}</span>
                        <input v-model="newPassword" type="text" class="ah-input" autocomplete="off" />
                    </label>
                    <button type="button" class="ah-btn ah-btn--primary pshare__submit" :disabled="!selectedSprintId || isSaving" @click="createShare">{{ $t('Projects.create_public_link') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

import { apiRequest } from '@/services';
import { useGetterFunctions } from "@/composable";
import { useFocusTrap } from '@/composable/useFocusTrap';
import { useDialogEscape } from '@/composable/useDialogEscape';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import WhoCanSeeModal from '@/components/molecules/WhoCanSee/WhoCanSeeModal.vue';

defineOptions({ name: 'PublicShareModal' });

const { t } = useI18n();
const $toast = useToast();
const { getUser } = useGetterFunctions();
const userId = inject('$userId');

const props = defineProps({
    projectData: {
        type: Object,
        required: true
    },
    modelValue: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['update:modelValue']);

const titleId = `pshare-${Math.random().toString(36).slice(2, 8)}-title`;
const dialogEl = ref(null);
const isOpen = computed(() => props.modelValue);
const close = () => emit('update:modelValue', false);
useFocusTrap(dialogEl, isOpen);
useDialogEscape(isOpen, close);

const selectedSprintId = ref('');
const share = ref(null);
const intakeItems = ref([]);
const isSaving = ref(false);
const newExpiry = ref('');
const newPassword = ref('');
const showWhoCanSee = ref(false);

const sprintOptions = computed(() => {
    const options = [];
    const add = (sprint, folderName = '') => {
        if (!sprint?.id) return;
        const name = sprint.name || t('Projects.sprint');
        options.push({ id: sprint.id, name, label: [folderName, name].filter(Boolean).join(' / ') });
    };
    Object.values(props.projectData?.sprintsObj || {}).forEach((sprint) => add(sprint));
    Object.values(props.projectData?.sprintsfolders || {}).forEach((folder) => {
        Object.values(folder?.sprintsObj || {}).forEach((sprint) => add(sprint, folder.folderName));
    });
    return options;
});

const selectedSprintName = computed(() => sprintOptions.value.find((sprint) => sprint.id === selectedSprintId.value)?.name || '');

const shareUrl = computed(() => share.value ? `${window.location.origin}/share/${share.value.token}` : '');

watch(() => props.modelValue, (open) => {
    if (open && !selectedSprintId.value && sprintOptions.value.length) {
        selectedSprintId.value = sprintOptions.value[0].id;
    } else if (open && selectedSprintId.value) {
        fetchShare();
    }
});

watch(selectedSprintId, () => {
    if (props.modelValue && selectedSprintId.value) fetchShare();
});

function fetchShare() {
    share.value = null;
    intakeItems.value = [];
    apiRequest('get', `/api/v2/public-shares?entityId=${selectedSprintId.value}`)
    .then((response) => {
        if (response.data?.status) {
            share.value = response.data.data;
            if (share.value?.allowIntake) fetchIntake();
        }
    })
    .catch((error) => console.error('ERROR in fetch share: ', error));
}

function fetchIntake() {
    apiRequest('get', `/api/v2/intake?shareId=${share.value._id}`)
    .then((response) => {
        intakeItems.value = response.data?.status ? (response.data.data || []) : [];
    })
    .catch((error) => console.error('ERROR in fetch intake: ', error));
}

function createShare() {
    isSaving.value = true;
    const user = getUser(userId.value);
    apiRequest('post', '/api/v2/public-shares', {
        entityType: 'sprint',
        entityId: selectedSprintId.value,
        allowIntake: false,
        expiresAt: newExpiry.value || undefined,
        password: newPassword.value || undefined,
        userData: { id: user.id, Employee_Name: user.Employee_Name },
    }).then((response) => {
        if (response.data?.status) {
            share.value = response.data.data;
            newPassword.value = '';
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in create share: ', error))
    .finally(() => { isSaving.value = false; });
}

function updateShare(update) {
    apiRequest('put', `/api/v2/public-shares/${share.value._id}`, update)
    .then((response) => {
        if (response.data?.status) {
            share.value = response.data.data;
            if (share.value.allowIntake) fetchIntake();
        }
    }).catch((error) => console.error('ERROR in update share: ', error));
}

function review(item, action) {
    apiRequest('post', '/api/v2/intake/review', { intakeId: item._id, action })
    .then((response) => {
        if (response.data?.status) fetchIntake();
    }).catch((error) => console.error('ERROR in review intake: ', error));
}

function copyLink() {
    navigator.clipboard.writeText(shareUrl.value);
    $toast.success(t('Toast.Link_is_Copied_to_clipboard'), { position: 'top-right' });
}

function deleteShare() {
    if (!share.value?._id) return;
    apiRequest('delete', `/api/v2/public-shares/${share.value._id}`)
    .then((response) => {
        if (response.data?.status) {
            share.value = null;
            intakeItems.value = [];
            newExpiry.value = '';
            newPassword.value = '';
            $toast.success(t('Projects.public_link_deleted'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in delete share: ', error));
}

function formatDate(d) {
    return d ? new Date(d).toLocaleDateString() : '';
}
</script>

<style scoped>
.pshare__back {
    position: fixed; inset: 0; z-index: 1000;
    background: color-mix(in srgb, var(--rail) 40%, transparent);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 72px 16px 16px;
}
.pshare__card {
    width: 520px; max-width: 100%; max-height: calc(100vh - 96px);
    display: flex; flex-direction: column;
    background: var(--surface); color: var(--ink);
    box-shadow: var(--shadow-modal);
    font: var(--text-body); text-align: left; white-space: normal;
}
.pshare__card:focus { outline: none; }
.pshare__head { flex: none; }
.pshare__body { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.pshare__close {
    display: inline-grid; place-items: center;
    border: 0; background: none; padding: 4px; border-radius: var(--r-chip);
    color: var(--ink-2); cursor: pointer;
}
.pshare__close:hover { color: var(--ink); background: var(--surface-hover); }
.pshare__close:focus-visible { outline: none; box-shadow: var(--focus); }
.pshare__select { appearance: auto; }
.pshare__who { align-self: flex-start; color: var(--brand); }
.pshare__linkrow { display: flex; flex-wrap: wrap; gap: 8px; }
.pshare__link { flex: 1 1 220px; width: auto; min-width: 0; font: var(--text-data); color: var(--ink-2); background: var(--surface-2); }
.pshare__toggles { display: flex; flex-wrap: wrap; gap: 8px 20px; }
.pshare__toggle { display: inline-flex; align-items: center; gap: 8px; margin: 0; color: var(--ink); cursor: pointer; }
.pshare__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; font: var(--text-small); color: var(--ink-2); }
.pshare__fact { display: inline-flex; align-items: center; gap: 5px; }
.pshare__delete { margin-left: auto; color: var(--danger-ink); }
.pshare__delete:hover:not(:disabled) { color: var(--danger-ink); background: var(--danger-bg); }
.pshare__intake { border-top: 1px solid var(--hairline); padding-top: 12px; }
.pshare__intake-head { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; }
.pshare__none { margin: 0; }
.pshare__intake-row { padding: 10px 0; border-bottom: 1px solid var(--hairline); }
.pshare__intake-row:last-child { border-bottom: 0; }
.pshare__intake-title { font: var(--text-h3); color: var(--ink); overflow-wrap: anywhere; }
.pshare__intake-desc { margin: 2px 0 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
.pshare__intake-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pshare__intake-from { display: inline-flex; flex-wrap: wrap; gap: 2px 8px; margin-right: auto; min-width: 0; overflow-wrap: anywhere; }
.pshare__create { display: flex; flex-direction: column; gap: 12px; }
.pshare__submit { align-self: flex-start; }

@media (max-width: 480px) {
    .pshare__back { padding: 12px; align-items: stretch; }
    .pshare__card { max-height: none; }
    .pshare__linkrow .ah-btn, .pshare__submit { width: 100%; }
}
</style>
