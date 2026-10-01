<template>
    <div
        v-if="item._id && item._id.length>6"
        :class="{'bg-light-gray': active, 'has-view-menu': hasViewMenu}"
        class="d-flex align-items-center text-nowrap border-top-radius-10-px wrapper h-100"
    >
        <button
            type="button"
            :aria-current="active ? 'true' : null"
            :class="{'border-left': firstChild && !active, 'border-right': !active, 'border-none activeViewList': active}"
            class="d-flex align-items-center font-size-14 view-list position-re cursor-pointer"
            :style="{ height: active ? '36px' : 'auto' }"
            @click.stop="$emit('click', item)"
        >
           <img :src="active ? projectComponentsIcons(item.keyName)?.activeIcon : projectComponentsIcons(item.keyName)?.icon" alt="" aria-hidden="true" class="mr-10px">
           <span class="gray81">{{ viewName }}</span>
           <span v-if="commentCount" class="count-block comment__count white">{{commentBadge}}</span>
           <img class="list__default-home" v-if="item.setAsDefault" :src="viewDefaultIcon" :alt="$t('ViewList.set_as_default')" />
           <img :src="active ? activePin : pin" v-if="item?.isPin && item.isPin" class="ml-10px active__pin-condition" :alt="$t('Projects.pinview')">
           <span class="notification-tick blinking position-sti ml-7px" v-if="item?.isPrivate" :title="$t('Projects.private_view')"></span>
        </button>
        <div class="view-list__menu" v-if="hasViewMenu">
           <DropDown :id="item._id" mode="menu" :zIndex="6">
                <template #button="{ triggerAttrs }">
                    <button type="button" class="dots ml-5px" v-bind="triggerAttrs" :aria-label="$t('Projects.view_options', {view: viewName})">
                        <img :src="dots" alt="" aria-hidden="true">
                    </button>
                </template>
                <template #options>
                    <div>
                        <ul class="p-0 m-0 justify-content-start" role="none">
                            <li role="none">
                                <button type="button" role="menuitem" class="embed-edit-options mb-7px view-list__menuitem cursor-pointer" @click="editOptions('Pin')">
                                    <img :src="pin" class="mr-14-px list__edit" alt="" aria-hidden="true" />
                                    <span class="font-ui font-weight-400 font-size-14 line-height-19 text-left gray81">{{item?.isPin ? $t('Projects.unpin') :$t('Projects.pinview') }}</span>
                                </button>
                            </li>
                            <li role="none" v-if="canToggleDefault">
                                <button type="button" role="menuitem" class="embed-edit-options mb-7px view-list__menuitem cursor-pointer" @click="editOptions('AddDefault')">
                                    <img :src="defaultView" class="mr-14-px list__edit" alt="" aria-hidden="true" />
                                    <span class="font-ui font-weight-400 font-size-14 line-height-19 text-left gray81">{{!item?.setAsDefault ? $t('ViewList.set_as_default') :$t('ViewList.remove_as_default') }}</span>
                                </button>
                            </li>
                            <li role="none" v-if="keepsSetup">
                                <button type="button" role="menuitem" class="embed-edit-options mb-7px view-list__menuitem cursor-pointer" data-action="save-view-template" @click="savingTemplate = true">
                                    <img :src="templateIcon" class="mr-14-px list__edit" alt="" aria-hidden="true" />
                                    <span class="font-ui font-weight-400 font-size-14 line-height-19 text-left gray81">{{ $t('ViewTemplates.save_as') }}</span>
                                </button>
                            </li>
                            <li role="none" v-if="isDeleteDisabled == false">
                                <button type="button" role="menuitem" class="embed-edit-options view-list__menuitem cursor-pointer" @click="isDelete = true">
                                    <img :src="deleteImage" class="mr-14-px list__edit" alt="" aria-hidden="true"/>
                                    <span class="font-ui font-weight-400 font-size-14 line-height-19 text-left red pt-2px">{{$t('Projects.deleteview')}}</span>
                                </button>
                            </li>
                        </ul>
                    </div>
                </template>
            </DropDown>
        </div>
        <ConfirmationSidebar
            v-model="isDelete"
            :title="$t('Projects.deleteview')"
            :message="`${$t('Filters.are_you_sure')}  ${escapeHtml(viewName)} ${$t('Projects.view')}?`"
            acceptButtonClass="btn-danger"
            @confirm="() => editOptions('Delete')"
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
// PACKAGES
import { defineProps, defineEmits, ref , inject ,computed} from 'vue';
import { escapeHtml } from '@/utils/notificationHtml';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';

// UTILS
import { deleteView , editView} from '@/components/molecules/EmbedView/helper';
import { useRoute , useRouter } from 'vue-router';
import { useStore } from 'vuex';
import { useCustomComposable } from '@/composable';
import { projectComponentsIcons } from '@/composable/commonFunction';

// COMPONENTS
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue"
import SaveViewTemplateDialog from '@/components/molecules/ProjectViews/SaveViewTemplateDialog.vue'
import { TEMPLATE_VIEW_TYPES } from '@/components/molecules/ProjectViews/viewTemplates'

const viewDefaultIcon = require("@/assets/images/svg/list_home_icon.svg");
const pin = require("@/assets/images/svg/pin.svg")
const activePin = require("@/assets/images/svg/active-pin.svg")
const defaultView = require("@/assets/images/svg/HomeVector.svg")
const dots  = require("@/assets/images/svg/PriorityIcon/dotsIcon.svg") 
const deleteImage = require('@/assets/images/svg/delete-red.svg')
const templateIcon = require('@/assets/images/svg/template_icon_gray.svg')
const isDelete = ref(false)
const savingTemplate = ref(false)
const route = useRoute();
const router = useRouter();
const companyId = inject('$companyId')
const project = inject("selectedProject")
const {checkPermission} = useCustomComposable();
const {commit} = useStore()
// The per-view triple-dot menu only renders when the user has this permission.
// The hover width-increase exists to make room for that menu, so gate it on the
// same permission -- a user without the menu should not get a pointless gap.
const hasViewMenu = computed(() => checkPermission('project.view_list', project.value?.isGlobalPermission) === true);
const toast = useToast()
const { t } = useI18n()

// PROPS
const props = defineProps({
    item: {
        type: Object,
        required: true
    },
    active: {
        type: Boolean,
        default: false
    },
    firstChild: {
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

const commentBadge = computed(() => (props.commentCount > 99 ? '+99' : props.commentCount));
const viewName = computed(() => props.item?.title || t(`ViewList.${props.item?.name}`));
const keepsSetup = computed(() => TEMPLATE_VIEW_TYPES.includes(props.item?.keyName));
/* A private view is not in the project's list, so the project default cannot point at it. */
const canToggleDefault = computed(() => {
    const views = project.value?.ProjectRequiredComponent;
    if (!views || props.item?.isPrivate) return false;
    const current = views.find((view) => view.setAsDefault === true);
    return !current || current._id === props.item?._id;
});

const editOptions = (type) =>{
    if(type === 'Pin') {
        let item = props.item
        if(props.item?.isPin){
            editView({cid: companyId.value, pid: project.value?._id}, item, false, 'isPin').then((res)=>{
                commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"edit",userId: ''});
            }).catch((err) => {
                console.error(err)
            })
        } else {
            editView({cid:companyId.value, pid: project.value?._id}, item, true, 'isPin').then((res)=>{
                commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"edit",userId: ''});
            }).catch((err) =>{
                console.error(err)
            })
        }
    }

    if(type === 'Delete'){
        if(route.query.tab == props.item?.keyName) {
            let viewFind = project.value?.ProjectRequiredComponent?.find((e) => e.setAsDefault && e.keyName !== props.item?.keyName) || project.value?.ProjectRequiredComponent?.find((e) => e.viewStatus && e.keyName !== props.item?.keyName) || project.value?.ProjectRequiredComponent.find((e)=> e.keyName !== props.item?.keyName);
            router.replace({query: {tab: viewFind ? viewFind?.keyName :'ProjectListView'}});
        }
        let item = props.item;
        deleteView({cid: companyId.value, pid: project.value?._id}, item ).then((res) => {
            commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"delete",userId: ''});
            toast.success(res.statusText, {position:'top-right'})
            isDelete.value = false
        })
    }
    if(type === 'AddDefault') {
        let item = props.item;
        if(!props.item?.setAsDefault) {
            editView({cid: companyId.value, pid: project.value?._id}, item, true, 'setAsDefault').then((res)=>{
                commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"edit",userId: ''});
            }).catch((err) => {
                console.error(err)
            })
        } else {
            editView({cid: companyId.value, pid: project.value?._id}, item, false, 'setAsDefault').then((res)=>{
                commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: project.value?._id,key:"ProjectView",subKey:"edit",userId: ''});
            }).catch((err) => {
                console.error(err)
            })
        }
    }
}

// EMITS
defineEmits(['click']);
</script>
<style scoped>
.list__edit{
    height: 20px;
    width: 15px;
}
.wrapper{
    border-radius: 8px 8px 0 0;
    position: relative;
}
.wrapper:hover:not(.bg-light-gray){
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
.view-list__menuitem{
    border: 0;
    background: none;
    font: inherit;
    width: 100%;
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
    border: 0;
    display: inline-flex;
}
.dots img{
    height: 100%;
    width: 100%;
    object-fit: contain;
}
.dots:hover{
    background: var(--fill);
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
/* "Default view" home marker — in-flow after the name (not an absolute corner
   badge) so it never overlaps the label. */
.list__default-home{
    height: 12px;
    width: 12px;
    margin-left: 6px;
    object-fit: contain;
    flex: 0 0 auto;
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

.active__pin-condition{
    height: 10px;
    width: 10px;
}
</style>
