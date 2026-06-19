<template>
    <div v-if="modelValue" class="pshare__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="pshare__card">
            <div class="d-flex align-items-center justify-content-between pshare__head">
                <span class="font-size-16 font-weight-700">{{ $t('Projects.public_link') }}</span>
                <span class="cursor-pointer font-size-16 pshare__close" @click="$emit('update:modelValue', false)">&#10005;</span>
            </div>
            <div class="d-flex align-items-center pshare__controls">
                <span class="font-size-13 font-weight-500 mr-10px">{{ $t('Projects.select_sprint') }}:</span>
                <select v-model="selectedSprintId" class="pshare__select font-size-13">
                    <option v-for="sprint in sprintOptions" :key="'ps-'+sprint.id" :value="sprint.id">
                        {{ sprint.folderName ? sprint.folderName + ' / ' : '' }}{{ sprint.name }}
                    </option>
                </select>
            </div>

            <template v-if="share">
                <div class="pshare__linkrow d-flex align-items-center">
                    <input class="pshare__link font-size-12" :value="shareUrl" readonly @focus="$event.target.select()" />
                    <button class="btn-primary font-size-12 ml-10px" @click="copyLink">{{ $t('Projects.copy_link') }}</button>
                </div>
                <div class="d-flex align-items-center pshare__toggles font-size-13">
                    <label class="d-flex align-items-center cursor-pointer mr-20px">
                        <input type="checkbox" :checked="share.enabled" @change="updateShare({ enabled: $event.target.checked })" />
                        <span class="ml-5px">{{ $t('Projects.link_enabled') }}</span>
                    </label>
                    <label class="d-flex align-items-center cursor-pointer">
                        <input type="checkbox" :checked="share.allowIntake" @change="updateShare({ allowIntake: $event.target.checked })" />
                        <span class="ml-5px">{{ $t('Projects.allow_intake') }}</span>
                    </label>
                </div>

                <div class="d-flex align-items-center pshare__meta font-size-12 gray81">
                    <span v-if="share.hasPassword" class="mr-10px">🔒 {{ $t('Projects.password_protected') }}</span>
                    <span v-if="share.expiresAt" class="mr-10px">{{ $t('Projects.share_expires_on') }}: {{ formatDate(share.expiresAt) }}</span>
                    <span class="cursor-pointer red" @click="deleteShare">{{ $t('Projects.delete_link') }}</span>
                </div>

                <div v-if="share.allowIntake" class="pshare__intake">
                    <div class="font-size-13 font-weight-700 mb-5px">{{ $t('Projects.intake_inbox') }} ({{ intakeItems.length }})</div>
                    <div v-if="!intakeItems.length" class="gray81 font-size-12">{{ $t('Projects.no_intake') }}</div>
                    <div v-for="item in intakeItems" :key="'intake-'+item._id" class="pshare__intake-row">
                        <div class="font-size-13 font-weight-600">{{ item.title }}</div>
                        <div v-if="item.description" class="font-size-12 gray81 pshare__intake-desc">{{ item.description }}</div>
                        <div class="d-flex align-items-center font-size-12">
                            <span class="gray81 mr-10px">{{ item.name || $t('Projects.anonymous') }}<template v-if="item.email"> · {{ item.email }}</template></span>
                            <span class="cursor-pointer blue mr-10px" @click="review(item, 'accept')">{{ $t('Projects.accept') }}</span>
                            <span class="cursor-pointer red" @click="review(item, 'reject')">{{ $t('Projects.reject') }}</span>
                        </div>
                    </div>
                </div>
            </template>
            <div v-else class="pshare__create">
                <div class="font-size-12 gray81 mb-5px">{{ $t('Projects.expires_optional') }}</div>
                <input type="date" v-model="newExpiry" class="pshare__field" />
                <div class="font-size-12 gray81 mb-5px">{{ $t('Projects.password_optional') }}</div>
                <input type="text" v-model="newPassword" class="pshare__field" autocomplete="off" />
                <button class="btn-primary font-size-13" :disabled="!selectedSprintId || isSaving" @click="createShare">{{ $t('Projects.create_public_link') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, inject, ref, watch } from "vue";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// UTILS
import { apiRequest } from '@/services';
import { useGetterFunctions } from "@/composable";

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

defineEmits(['update:modelValue']);

const selectedSprintId = ref('');
const share = ref(null);
const intakeItems = ref([]);
const isSaving = ref(false);
const newExpiry = ref('');
const newPassword = ref('');

const sprintOptions = computed(() => {
    const options = [];
    Object.values(props.projectData?.sprintsObj || {}).forEach((sprint) => {
        if (sprint?.id) options.push({ id: sprint.id, name: sprint.name || 'Sprint' });
    });
    Object.values(props.projectData?.sprintsfolders || {}).forEach((folder) => {
        Object.values(folder?.sprintsObj || {}).forEach((sprint) => {
            if (sprint?.id) options.push({ id: sprint.id, name: sprint.name || 'Sprint', folderName: folder.folderName || '' });
        });
    });
    return options;
});

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
            $toast.success('Public link deleted', { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in delete share: ', error));
}

function formatDate(d) {
    return d ? new Date(d).toLocaleDateString() : '';
}
</script>

<style scoped>
.pshare__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.pshare__card {
    background: #fff;
    border-radius: 10px;
    width: min(560px, 92vw);
    max-height: 76vh;
    overflow-y: auto;
    padding: 16px 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.pshare__head { margin-bottom: 12px; }
.pshare__close { color: #9a9a9a; }
.pshare__close:hover { color: #e84a4a; }
.pshare__controls { margin-bottom: 12px; }
.pshare__select {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 6px 8px;
    background: #fff;
    min-width: 220px;
}
.pshare__linkrow { margin-bottom: 10px; }
.pshare__link {
    flex: 1;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 7px 10px;
    background: #fafafa;
    color: #555;
}
.pshare__toggles { margin-bottom: 14px; }
.pshare__create { padding: 10px 0; }
.pshare__intake { border-top: 1px solid #eee; padding-top: 10px; }
.pshare__intake-row { padding: 8px 0; border-bottom: 1px solid #f2f2f2; }
.pshare__intake-desc { margin: 2px 0 4px; white-space: pre-wrap; }
.pshare__field { display: block; width: 100%; box-sizing: border-box; border: 1px solid #e0e0e0; border-radius: 6px; padding: 7px 10px; margin-bottom: 10px; font-size: 13px; }
.pshare__meta { margin: 0 0 12px; }
.pshare__meta .red { margin-left: auto; }
</style>
