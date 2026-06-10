<template>
    <div v-if="modelValue" class="pages__overlay" @click.self="$emit('update:modelValue', false)">
        <div class="pages__card">
            <div class="pages__sidebar">
                <div class="d-flex align-items-center justify-content-between pages__sidebar-head">
                    <span class="font-size-14 font-weight-700">{{ $t('Projects.pages') }}</span>
                    <span class="blue font-size-13 cursor-pointer" @click="createPage">+ {{ $t('Projects.add_page') }}</span>
                </div>
                <div v-if="!pages.length" class="gray81 font-size-12 pages__empty">{{ $t('Projects.no_pages') }}</div>
                <div
                    v-for="page in pages"
                    :key="'page-'+page._id"
                    class="cursor-pointer pages__item font-size-13"
                    :class="{'pages__item--active': current && String(current._id) === String(page._id)}"
                    @click="openPage(page._id)"
                >
                    <span class="pages__item-name">{{ page.title }}</span>
                </div>
            </div>
            <div class="pages__main">
                <div class="d-flex align-items-center justify-content-between pages__main-head">
                    <input
                        v-if="current"
                        v-model="current.title"
                        type="text"
                        class="pages__title-input font-size-15 font-weight-600"
                    />
                    <span v-else class="gray81 font-size-13">{{ $t('Projects.select_page') }}</span>
                    <div class="d-flex align-items-center">
                        <button v-if="current" class="btn-primary font-size-13 mr-10px" :disabled="isSaving" @click="savePage">{{ $t('Projects.save_page') }}</button>
                        <span v-if="current" class="cursor-pointer red font-size-13 mr-10px" @click="deletePage">{{ $t('Projects.delete') }}</span>
                        <span class="cursor-pointer font-size-16 pages__close" @click="$emit('update:modelValue', false)">&#10005;</span>
                    </div>
                </div>
                <VueEditor v-if="current" v-model="contentHtml" class="pages__editor" />
                <div v-if="current && versions.length" class="pages__versions font-size-12">
                    <span class="gray81">{{ $t('Projects.page_versions') }}:</span>
                    <span
                        v-for="version in versions"
                        :key="'ver-'+version._id"
                        class="cursor-pointer blue pages__version"
                        :title="version.title"
                        @click="restoreVersion(version)"
                    >{{ formatStamp(version.createdAt) }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { defineProps, inject, ref, watch } from "vue";
import { VueEditor } from "vue3-editor";
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

const pages = ref([]);
const current = ref(null);
const contentHtml = ref('');
const versions = ref([]);
const isSaving = ref(false);

watch(() => props.modelValue, (open) => {
    if (open) fetchPages();
});

function userData() {
    const user = getUser(userId.value);
    return { id: user.id, Employee_Name: user.Employee_Name };
}

function fetchPages() {
    apiRequest('get', `/api/v2/pages?projectId=${props.projectData._id}`)
    .then((response) => {
        pages.value = response.data?.status ? (response.data.data || []) : [];
    })
    .catch((error) => console.error('ERROR in fetch pages: ', error));
}

function openPage(id) {
    apiRequest('get', `/api/v2/pages/${id}`)
    .then((response) => {
        if (response.data?.status) {
            current.value = response.data.data;
            contentHtml.value = (current.value.content && current.value.content.html) || '';
            fetchVersions(id);
        }
    })
    .catch((error) => console.error('ERROR in open page: ', error));
}

function fetchVersions(id) {
    apiRequest('get', `/api/v2/pages/${id}/versions`)
    .then((response) => {
        versions.value = response.data?.status ? (response.data.data || []) : [];
    })
    .catch((error) => console.error('ERROR in fetch versions: ', error));
}

function createPage() {
    apiRequest('post', '/api/v2/pages', {
        title: t('Projects.untitled_page'),
        projectId: props.projectData._id,
        userData: userData(),
    }).then((response) => {
        if (response.data?.status) {
            fetchPages();
            openPage(response.data.data._id);
        }
    }).catch((error) => console.error('ERROR in create page: ', error));
}

function savePage() {
    if (!current.value || isSaving.value) return;
    isSaving.value = true;
    apiRequest('put', `/api/v2/pages/${current.value._id}`, {
        title: current.value.title,
        contentHtml: contentHtml.value,
        userData: userData(),
    }).then((response) => {
        if (response.data?.status) {
            $toast.success(response.data.statusText, { position: 'top-right' });
            fetchPages();
            fetchVersions(current.value._id);
        } else {
            $toast.error(response.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in save page: ', error))
    .finally(() => { isSaving.value = false; });
}

function deletePage() {
    if (!current.value) return;
    apiRequest('delete', `/api/v2/pages/${current.value._id}`)
    .then((response) => {
        if (response.data?.status) {
            current.value = null;
            contentHtml.value = '';
            versions.value = [];
            fetchPages();
        }
    }).catch((error) => console.error('ERROR in delete page: ', error));
}

function restoreVersion(version) {
    if (!current.value) return;
    apiRequest('post', `/api/v2/pages/${current.value._id}/restore`, {
        versionId: version._id,
        userData: userData(),
    }).then((response) => {
        if (response.data?.status) {
            openPage(current.value._id);
            $toast.success(t('Projects.page_restored'), { position: 'top-right' });
        }
    }).catch((error) => console.error('ERROR in restore version: ', error));
}

function formatStamp(value) {
    const date = new Date(value);
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
</script>

<style scoped>
.pages__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.pages__card {
    background: #fff;
    border-radius: 10px;
    width: min(960px, 94vw);
    height: min(640px, 86vh);
    display: flex;
    overflow: hidden;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}
.pages__sidebar {
    width: 240px;
    flex: none;
    border-right: 1px solid #eee;
    overflow-y: auto;
    padding: 14px 12px;
}
.pages__sidebar-head { margin-bottom: 10px; }
.pages__empty { padding: 16px 4px; }
.pages__item {
    padding: 7px 8px;
    border-radius: 6px;
    min-width: 0;
}
.pages__item:hover { background: #f7f9fc; }
.pages__item--active { background: #f3f0ff; }
.pages__item-name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pages__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    min-width: 0;
}
.pages__main-head { margin-bottom: 10px; }
.pages__title-input {
    border: none;
    outline: none;
    flex: 1;
    margin-right: 12px;
    border-bottom: 1px solid transparent;
}
.pages__title-input:focus { border-bottom-color: #7b68ee; }
.pages__close { color: #9a9a9a; }
.pages__close:hover { color: #e84a4a; }
.pages__editor {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
}
.pages__editor :deep(.ql-container) { flex: 1; overflow-y: auto; }
.pages__versions {
    margin-top: 8px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}
.pages__version { text-decoration: underline; }
</style>
