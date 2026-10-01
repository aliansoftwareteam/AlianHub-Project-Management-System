<template>
    <div
        v-if="item._id && item._id.length>6"
        :id="`view_tab_${viewKey}`"
        data-view-tab
        :class="{'is-active': active, 'has-view-menu': hasViewMenu && !renaming}"
        class="d-flex align-items-center text-nowrap border-top-radius-10-px wrapper h-100"
    >
        <form
            v-if="renaming"
            class="d-flex align-items-center view-list view-list--renaming"
            data-view-rename-form
            @submit.prevent="saveRename(true)"
            @keydown.esc.stop.prevent="cancelRename"
        >
            <span v-if="viewIcon" class="ah-mask-icon view-list__icon" :style="iconStyle" aria-hidden="true"></span>
            <input
                ref="nameInput"
                v-model="draftName"
                type="text"
                class="ah-input view-list__input"
                data-view-rename
                :maxlength="LIMITS.title"
                :style="{ width: `${Math.min(Math.max(draftName.length + 2, 8), 32)}ch` }"
                :aria-label="$t('SavedViews.rename_label', { name: viewName })"
                @blur="saveRename(false)"
            >
        </form>
        <button
            v-else
            ref="tabButton"
            type="button"
            :aria-current="active ? 'true' : null"
            :class="{'activeViewList': active}"
            class="d-flex align-items-center font-size-14 view-list position-re cursor-pointer"
            @click.stop="$emit('click', item)"
        >
           <span v-if="viewIcon" class="ah-mask-icon view-list__icon" :style="iconStyle" aria-hidden="true"></span>
           <span class="view-list__name">{{ viewName }}</span>
           <span v-if="commentCount" class="count-block comment__count">{{commentBadge}}</span>
           <span v-if="item.setAsDefault" class="view-list__mark" role="img" :aria-label="$t('Projects.default_view')" :title="$t('Projects.default_view')">
               <ShellIcon name="home" :size="12" />
           </span>
           <span v-if="item.isPin" class="view-list__mark" role="img" :aria-label="$t('Projects.pinview')" :title="$t('Projects.pinview')">
               <ShellIcon name="pin" :size="11" />
           </span>
           <span v-if="item.isPrivate" class="view-list__mark" data-private-marker role="img" :aria-label="$t('Projects.private_view')" :title="$t('Projects.private_view')">
               <ShellIcon name="lock" :size="12" />
           </span>
        </button>
        <div class="view-list__menu" v-if="hasViewMenu && !renaming">
           <DropDown :id="`view_menu_${viewKey}`" mode="menu" themed :zIndex="6">
                <template #button="{ triggerAttrs }">
                    <button type="button" class="dots ml-5px" v-bind="triggerAttrs" :aria-label="$t('Projects.view_options', {view: viewName})">
                        <ShellIcon name="dots" :size="14" />
                    </button>
                </template>
                <template #options>
                    <ul class="view-list__options" role="none">
                        <li role="none">
                            <button type="button" role="menuitem" class="view-list__menuitem" data-action="pin-view" @click="togglePin">
                                <ShellIcon name="pin" :size="14" />
                                <span>{{item?.isPin ? $t('Projects.unpin') :$t('Projects.pinview') }}</span>
                            </button>
                        </li>
                        <li role="none" v-if="canRename">
                            <button type="button" role="menuitem" class="view-list__menuitem" data-action="rename-view" @click="startRename">
                                <ShellIcon name="edit" :size="14" />
                                <span>{{ $t('SavedViews.rename') }}</span>
                            </button>
                        </li>
                        <li role="none" v-if="canToggleDefault">
                            <button type="button" role="menuitem" class="view-list__menuitem" data-action="default-view" @click="toggleDefault">
                                <ShellIcon name="home" :size="14" />
                                <span>{{!item?.setAsDefault ? $t('ViewList.set_as_default') :$t('ViewList.remove_as_default') }}</span>
                            </button>
                        </li>
                        <li role="none" v-if="keepsSetup">
                            <button type="button" role="menuitem" class="view-list__menuitem" data-action="save-view-template" @click="savingTemplate = true">
                                <ShellIcon name="template" :size="14" />
                                <span>{{ $t('ViewTemplates.save_as') }}</span>
                            </button>
                        </li>
                        <li role="none" v-if="isDeleteDisabled == false">
                            <button type="button" role="menuitem" class="view-list__menuitem view-list__menuitem--danger" data-action="delete-view" @click="isDelete = true">
                                <ShellIcon name="trash" :size="14" />
                                <span>{{$t('Projects.deleteview')}}</span>
                            </button>
                        </li>
                    </ul>
                </template>
            </DropDown>
        </div>
        <ConfirmationSidebar
            v-model="isDelete"
            :title="$t('Projects.deleteview')"
            :message="`${$t('Filters.are_you_sure')}  ${escapeHtml(viewName)} ${$t('Projects.view')}?`"
            acceptButtonClass="btn-danger"
            @confirm="removeView"
            :acceptButton="$t('Projects.delete')"
            >
            <template #body>
                <div></div>
            </template>
        </ConfirmationSidebar>
        <SaveViewTemplateDialog
            v-if="savingTemplate"
            :view="item"
            :viewName="viewName"
            :projectId="String(project?._id || '')"
            @close="savingTemplate = false"
        />
    </div>
</template>

<script setup>
import { defineProps, defineEmits, ref, inject, computed, nextTick } from 'vue';
import { escapeHtml } from '@/utils/notificationHtml';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { useRoute , useRouter } from 'vue-router';
import { useStore } from 'vuex';
import { LIMITS } from '@viewSettings';

import { deleteView , editView} from '@/components/molecules/EmbedView/helper';
import { useCustomComposable } from '@/composable';
import { projectComponentsIcons } from '@/composable/commonFunction';
import { deletePrivateView, updatePrivateView } from '@/views/Projects/composables/savedViewApi';
import { viewKeyOf } from '@/views/Projects/composables/savedViewSettings';

import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue'
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import SaveViewTemplateDialog from '@/components/molecules/ProjectViews/SaveViewTemplateDialog.vue'
import { TEMPLATE_VIEW_TYPES } from '@/components/molecules/ProjectViews/viewTemplates'
import { maskOf } from '@/utils/iconMask'

/* The server lets either of these change a project's views (FIELD_PERMISSIONS.ProjectRequiredComponent). */
const SHARED_VIEW_PERMISSIONS = ['project.view_list', 'project.project_details'];

const isDelete = ref(false)
const savingTemplate = ref(false)
const renaming = ref(false)
const draftName = ref('')
const nameInput = ref(null)
const tabButton = ref(null)
const route = useRoute();
const router = useRouter();
const companyId = inject('$companyId')
const userId = inject('$userId', ref(''))
const project = inject("selectedProject")
const {checkPermission} = useCustomComposable();
const {commit, getters} = useStore()
const toast = useToast()
const { t } = useI18n()

const props = defineProps({
    item: {
        type: Object,
        required: true
    },
    active: {
        type: Boolean,
        default: false
    },
    commentCount: {
        type: Number,
        default: 0
    },
    isDeleteDisabled: {
        type: Boolean,
        default: false
    }
})

defineEmits(['click']);

const may = (key) => checkPermission(key, project.value?.isGlobalPermission) === true;
/* A private view lives on its owner's member row, so the owner needs no project permission to manage it. */
const hasViewMenu = computed(() => Boolean(props.item?.isPrivate) || may('project.view_list'));
const canRename = computed(() => Boolean(props.item?.isPrivate) || SHARED_VIEW_PERMISSIONS.some(may));

const viewKey = computed(() => viewKeyOf(props.item));
const commentBadge = computed(() => (props.commentCount > 99 ? '+99' : props.commentCount));
const viewName = computed(() => props.item?.title || t(`ViewList.${props.item?.name}`));
const keepsSetup = computed(() => TEMPLATE_VIEW_TYPES.includes(props.item?.keyName));
const viewIcon = computed(() => {
    const icons = projectComponentsIcons(props.item.keyName);
    return (props.active && icons?.activeIcon) || icons?.icon || '';
});
const iconStyle = computed(() => maskOf(viewIcon.value));
/* A private view is not in the project's list, so the project default cannot point at it. */
const canToggleDefault = computed(() => {
    const views = project.value?.ProjectRequiredComponent;
    if (!views || props.item?.isPrivate) return false;
    const current = views.find((view) => view.setAsDefault === true);
    return !current || current._id === props.item?._id;
});

const projectIds = () => ({ cid: companyId?.value, pid: project.value?._id });
const memberRow = () => (getters['settings/companyUsers'] || []).find((row) => row && row.userId === userId.value);

const editShared = (field, value) => editView(projectIds(), props.item, value, field).then((res) => {
    commit('projectData/projectLocalUpdate', { itemData: res.data, projectId: project.value?._id, key: 'ProjectView', subKey: 'edit', userId: '' });
});

/* A private view copies its catalogue row's `_id`, which a shared view of the project also carries,
 * so a write addressed to the project by that id would change the shared view instead. */
const storeMine = (row, change) => commit('settings/mutateCompanyUsers', {
    data: { ...row, ProjectRequiredComponent: change(row.ProjectRequiredComponent || []) },
    op: 'modified',
});

const editMine = async (field, value) => {
    const row = memberRow();
    if (!row) throw new Error('The member row is not loaded.');
    await updatePrivateView(row._id, props.item.id, field, value);
    storeMine(row, (views) => views.map((view) => (view.id === props.item.id ? { ...view, [field]: value } : view)));
};

const edit = (field, value) => (props.item?.isPrivate ? editMine(field, value) : editShared(field, value));

const failed = (error) => {
    console.error('ERROR in changing the view: ', error);
    toast.error(t('SavedViews.failed'), { position: 'top-right' });
};

const togglePin = () => edit('isPin', !props.item?.isPin).catch(failed);
const toggleDefault = () => edit('setAsDefault', !props.item?.setAsDefault).catch(failed);

async function startRename() {
    draftName.value = viewName.value;
    renaming.value = true;
    await nextTick();
    nameInput.value?.focus();
    nameInput.value?.select();
}

async function endRename(keepFocus) {
    renaming.value = false;
    if (!keepFocus) return;
    await nextTick();
    tabButton.value?.focus();
}

const cancelRename = () => endRename(true);

/* Taking the field away also blurs it, so only the first of the two saves runs. */
async function saveRename(keepFocus) {
    if (!renaming.value) return;
    const title = draftName.value.trim().slice(0, LIMITS.title);
    endRename(keepFocus);
    if (!title || title === viewName.value) return;
    try {
        await edit('title', title);
    } catch (error) {
        console.error('ERROR in renaming the view: ', error);
        toast.error(t('SavedViews.rename_failed'), { position: 'top-right' });
    }
}

async function removeMine() {
    const row = memberRow();
    if (!row) throw new Error('The member row is not loaded.');
    await deletePrivateView(row._id, props.item.id);
    storeMine(row, (views) => views.filter((view) => view.id !== props.item.id));
    toast.success(t('Toast.View_Deleted_Successfully'), { position: 'top-right' });
}

async function removeShared() {
    if (route.query.tab == props.item?.keyName) {
        const others = (project.value?.ProjectRequiredComponent || []).filter((view) => view.keyName !== props.item?.keyName);
        const next = others.find((view) => view.setAsDefault) || others.find((view) => view.viewStatus) || others[0];
        router.replace({ query: { tab: next ? next.keyName : 'ProjectListView' } });
    }
    const res = await deleteView(projectIds(), props.item);
    commit('projectData/projectLocalUpdate', { itemData: res.data, projectId: project.value?._id, key: 'ProjectView', subKey: 'delete', userId: '' });
    toast.success(res.statusText, { position: 'top-right' });
}

const removeView = () => (props.item?.isPrivate ? removeMine() : removeShared())
    .then(() => { isDelete.value = false; })
    .catch(failed);
</script>
<style scoped>
.wrapper{
    border-radius: 8px 8px 0 0;
    position: relative;
}
.wrapper:hover:not(.is-active){
    background: var(--surface-hover);
}
.view-list{
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: inherit;
    -webkit-appearance: none;
    appearance: none;
}
.view-list--renaming{
    margin: 0;
}
.ah-input.view-list__input{
    height: 24px;
    min-width: 0;
    max-width: 240px;
    padding: 0 6px;
    font: var(--text-small);
}
.view-list__icon{
    margin-right: 8px;
    color: var(--ink-2);
}
.is-active .view-list__icon{
    color: var(--brand);
}
/* In-flow after the name, never an absolute corner badge, so a marker cannot overlap the label. */
.view-list__mark{
    display: inline-flex;
    flex: 0 0 auto;
    margin-left: 6px;
    color: var(--ink-2);
}
.is-active .view-list__mark{
    color: var(--brand);
}
.view-list__options{
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
}
.view-list__menuitem{
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-radius: var(--r-chip);
    background: none;
    color: var(--ink);
    font: var(--text-body);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
}
.view-list__menuitem svg{
    flex: none;
    color: var(--ink-2);
}
.view-list__menuitem:hover{
    background: var(--surface-hover);
}
.view-list__menuitem:focus-visible{
    outline: none;
    box-shadow: var(--focus);
}
.view-list__menuitem--danger,
.view-list__menuitem--danger svg{
    color: var(--danger);
}
/* ⋯ menu: out of flow at the tab's right edge (so its dropdown popup is never
   clipped), shown only on hover. On hover the tab grows its right padding
   (.wrapper:hover .view-list) to open clear space here, so the ⋯ never covers
   the view name. */
.view-list__menu{
    position: absolute;
    right: 2px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
}
.dots{
    height: 24px;
    width: 24px;
    padding: 5px;
    border-radius: 5px;
    box-sizing: border-box;
    cursor: pointer;
    background: transparent;
    color: var(--ink-2);
    border: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.dots:hover{
    background: var(--fill);
    color: var(--ink);
}
/* .dots is visibility:hidden until hover (views/Projects/style.css), which also
   takes it out of the tab order — so reveal it once focus is anywhere in the
   tab, or the ⋯ menu is unreachable by keyboard. */
.wrapper:focus-within .dots{
    visibility: visible;
}
/* Focus sits in the teleported menu while it is open, so focus-within no longer
   holds; a hidden ⋯ would refuse the focus the menu hands back on Escape. */
.dots[aria-expanded="true"]{
    visibility: visible;
}
/* In-flow pill after the view name (not an absolute corner badge) so the
   comment count never overlaps the label — in any state, at any tab width. */
.count-block.comment__count{
   color: var(--warn) !important;
   background-color: transparent;
   border: 1px solid var(--warn) !important;
   margin-left: 6px;
   flex: 0 0 auto;
}
</style>
