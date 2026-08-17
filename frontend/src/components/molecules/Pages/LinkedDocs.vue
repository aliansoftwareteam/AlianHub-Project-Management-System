<template>
    <div class="overflow-auto style-scroll mobile__bg--withPadding mt-10px">
        <div class="w-100 d-flex align-items-center justify-content-between">
            <span :class="{'font-size-16 font-weight-600' : clientWidth <= 767 , 'font-size-14 font-weight-700' : clientWidth > 767 }" class="font-weight-700 font-size-14">{{$t('Projects.linked_docs')}}</span>
            <div v-if="!mode" class="d-flex align-items-center">
                <span @click="startCreating" class="blue font-size-14 font-weight-500 cursor-pointer pl-20px text-decoration-underline">+ {{$t('Projects.add_page')}}</span>
                <span @click="startAdding" class="blue font-size-14 font-weight-500 cursor-pointer pl-20px text-decoration-underline">+ {{$t('Projects.task_link_doc')}}</span>
            </div>
        </div>

        <!-- Existing links -->
        <div v-if="docs.length > 0" class="linked-docs__list">
            <div
                v-for="doc in docs"
                :key="'linked-doc-'+doc._id"
                class="d-flex align-items-center justify-content-between px-1 linked-docs__row"
            >
                <div class="d-flex align-items-center linked-docs__row-main" @click="$emit('open', doc)">
                    <span class="linked-docs__icon" v-html="ICON_DOC"></span>
                    <span class="font-size-13 font-weight-400 blue linked-docs__name" :title="doc.title">{{ doc.title || $t('Projects.untitled_page') }}</span>
                    <span v-if="doc.visibility === 'private'" class="font-size-11 font-weight-500 linked-docs__chip">{{$t('Projects.doc_private')}}</span>
                </div>
                <span
                    class="font-size-14 cursor-pointer linked-docs__remove"
                    :class="{'pointer-event-none': busyId === String(doc._id)}"
                    :title="$t('Projects.doc_unlink')"
                    @click.stop="unlink(doc)"
                >&#10005;</span>
            </div>
        </div>
        <div v-else-if="!mode && !isLoading" class="gray81 font-size-12 py-10px">
            {{$t('Projects.task_no_docs')}}
        </div>

        <!-- Add-link row: pick a doc the project already has. -->
        <div v-if="mode === 'link'" class="linked-docs__add-row">
            <div class="d-flex align-items-center">
                <input
                    ref="inputRef"
                    v-model="searchQuery"
                    type="text"
                    class="linked-docs__input font-size-13"
                    :placeholder="$t('Projects.search_pages')"
                />
                <span @click="closeRow" class="font-size-13 cursor-pointer gray81 pl-10px">{{$t('Projects.cancel')}}</span>
            </div>
            <div v-if="isSearching" class="gray81 font-size-12 py-5px">{{$t('Projects.searching')}}</div>
            <div v-else-if="candidates.length > 0" class="linked-docs__results">
                <div
                    v-for="doc in candidates"
                    :key="'doc-result-'+doc._id"
                    class="d-flex align-items-center px-1 cursor-pointer linked-docs__row"
                    :class="{'pointer-event-none opacity-5': busyId !== ''}"
                    @click="link(doc)"
                >
                    <span class="linked-docs__icon" v-html="ICON_DOC"></span>
                    <span class="font-size-13 font-weight-400 linked-docs__name">{{ doc.title || $t('Projects.untitled_page') }}</span>
                </div>
            </div>
            <div v-else class="gray81 font-size-12 py-5px">
                {{ searchQuery ? $t('Projects.no_pages_match') : $t('Projects.doc_all_linked') }}
            </div>
        </div>

        <!-- New-doc row. Asks for a title up front rather than dropping an "Untitled doc"
             into the project the moment the link is clicked. -->
        <div v-else-if="mode === 'create'" class="linked-docs__add-row">
            <div class="d-flex align-items-center">
                <input
                    ref="inputRef"
                    v-model="newTitle"
                    type="text"
                    class="linked-docs__input font-size-13"
                    :placeholder="$t('Projects.page_title_placeholder')"
                    @keyup.enter="createDoc"
                />
                <span
                    class="blue font-size-13 font-weight-500 cursor-pointer pl-10px"
                    :class="{'pointer-event-none opacity-5': !newTitle.trim() || isCreating}"
                    @click="createDoc"
                >{{$t('Projects.create')}}</span>
                <span @click="closeRow" class="font-size-13 cursor-pointer gray81 pl-10px">{{$t('Projects.cancel')}}</span>
            </div>
            <div class="gray81 font-size-12 py-5px">{{$t('Projects.doc_create_hint')}}</div>
        </div>
    </div>
</template>

<script setup>
import { computed, defineProps, inject, nextTick, ref, watch } from 'vue';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';

// Docs attached to this task.
//
// The link is stored on the DOC (pages.linkedTasks), so linking from here is a write to
// the doc, not to the task — one owner for the relationship, and no chance of the two
// sides disagreeing about whether a link exists.
const props = defineProps({
    task: { type: Object, required: true },
    // Changes when the docs panel closes — a doc may have been renamed or deleted in it.
    refreshKey: { type: Number, default: 0 },
});
const emit = defineEmits(['open']);

const { t } = useI18n();
const $toast = useToast();
const clientWidth = inject("$clientWidth");

const ICON_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

const docs = ref([]);          // linked to this task
const projectDocs = ref([]);   // everything in the project, for the picker
const mode = ref('');          // '' | 'link' | 'create' — one open row at a time
const isLoading = ref(false);
const isSearching = ref(false);
const isCreating = ref(false);
const searchQuery = ref('');
const newTitle = ref('');
const busyId = ref('');
const inputRef = ref(null);

const taskId = computed(() => String(props.task?._id || ''));
const projectId = computed(() => String(props.task?.ProjectID || props.task?.projectId || ''));

// Already-linked docs are not offered again — picking one would be a no-op that looks
// like it worked.
const candidates = computed(() => {
    const linked = new Set(docs.value.map((d) => String(d._id)));
    const term = searchQuery.value.trim().toLowerCase();
    return projectDocs.value
        .filter((d) => !linked.has(String(d._id)))
        .filter((d) => !term || String(d.title || '').toLowerCase().includes(term));
});

const loadLinked = () => {
    if (!taskId.value) { docs.value = []; return; }
    isLoading.value = true;
    apiRequest('get', `/api/v2/pages?taskId=${taskId.value}`)
    .then((res) => { docs.value = res.data?.status ? (res.data.data || []) : []; })
    .catch(() => { docs.value = []; })
    .finally(() => { isLoading.value = false; });
};

const loadProjectDocs = () => {
    if (!projectId.value) { projectDocs.value = []; return; }
    isSearching.value = true;
    apiRequest('get', `/api/v2/pages?projectId=${projectId.value}`)
    .then((res) => { projectDocs.value = res.data?.status ? (res.data.data || []) : []; })
    .catch(() => { projectDocs.value = []; })
    .finally(() => { isSearching.value = false; });
};

const startAdding = () => {
    mode.value = 'link';
    searchQuery.value = '';
    loadProjectDocs();
    nextTick(() => inputRef.value?.focus());
};

const startCreating = () => {
    mode.value = 'create';
    newTitle.value = '';
    nextTick(() => inputRef.value?.focus());
};

const closeRow = () => {
    mode.value = '';
    searchQuery.value = '';
    newTitle.value = '';
};

/**
 * Write the doc's task list back with this task added or removed.
 *
 * The whole array is sent because that is what the endpoint takes. It is read from the
 * doc we were handed rather than assumed empty, so a doc linked to three other tasks does
 * not lose them when it is linked to a fourth.
 */
const writeLinks = (doc, nextIds) => {
    busyId.value = String(doc._id);
    return apiRequest('put', `/api/v2/pages/${doc._id}`, { linkedTasks: nextIds })
        .then((res) => {
            if (!res.data?.status) {
                $toast.error(res.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
                return false;
            }
            return true;
        })
        .catch((error) => {
            $toast.error(error?.response?.data?.statusText || error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
            return false;
        })
        .finally(() => { busyId.value = ''; });
};

const link = async (doc) => {
    const current = (doc.linkedTasks || []).map(String);
    if (current.includes(taskId.value)) return;
    const ok = await writeLinks(doc, [...current, taskId.value]);
    if (!ok) return;
    closeRow();
    loadLinked();
};

/**
 * Create a doc that is linked to this task from the moment it exists.
 *
 * The link goes in the create call rather than a follow-up update: a failed second call
 * would leave a doc stranded in the project that the task it was written for cannot see.
 * It opens straight away, because someone who just named a doc means to write in it.
 */
const createDoc = async () => {
    const title = newTitle.value.trim();
    if (!title || isCreating.value) return;
    isCreating.value = true;
    try {
        const res = await apiRequest('post', '/api/v2/pages', {
            title,
            ...(projectId.value ? { projectId: projectId.value } : {}),
            linkedTasks: [taskId.value],
        });
        if (!res.data?.status) {
            $toast.error(res.data?.statusText || t('Toast.something_went_wrong'), { position: 'top-right' });
            return;
        }
        closeRow();
        loadLinked();
        emit('open', res.data.data);
    } catch (error) {
        $toast.error(error?.response?.data?.statusText || error?.message || t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isCreating.value = false;
    }
};

const unlink = async (doc) => {
    const current = (doc.linkedTasks || []).map(String);
    const ok = await writeLinks(doc, current.filter((x) => x !== taskId.value));
    if (!ok) return;
    loadLinked();
};

watch(taskId, loadLinked, { immediate: true });
watch(() => props.refreshKey, loadLinked);
</script>

<style scoped>
.linked-docs__row {
    min-height: 36px;
    padding-top: 4px;
    padding-bottom: 4px;
}
/* Separators BETWEEN rows only. A rule under the last one reads as the start of another
   row that never arrives, and stacks against the next section's own spacing. */
.linked-docs__list .linked-docs__row:not(:last-child),
.linked-docs__results .linked-docs__row:not(:last-child) {
    border-bottom: 1px solid #e5e5e5;
}
.linked-docs__row-main {
    min-width: 0;
    flex: 1;
    cursor: pointer;
}
.linked-docs__icon {
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
    margin-right: 8px;
    color: #9a9a9a;
    display: inline-flex;
}
.linked-docs__icon :deep(svg) {
    width: 100%;
    height: 100%;
}
.linked-docs__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.linked-docs__row-main:hover .linked-docs__name {
    text-decoration: underline;
}
.linked-docs__chip {
    background: #f0f0f0;
    border-radius: 10px;
    padding: 2px 8px;
    margin-left: 10px;
    color: #9a9a9a;
    white-space: nowrap;
}
.linked-docs__remove {
    color: #9a9a9a;
    padding: 0 4px;
}
.linked-docs__remove:hover {
    color: #e84a4a;
}
.linked-docs__add-row {
    padding: 8px 0;
}
.linked-docs__input {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid #e0e0e0;
    border-radius: 5px;
    outline: none;
}
.linked-docs__input:focus {
    border-color: #7b68ee;
}
.linked-docs__results {
    max-height: 220px;
    overflow-y: auto;
}
</style>
