<template>
    <div
        :class="{'bg-light-blue black': selected && highlight, 'bg-light-gray black': selected && !highlight, 'bg-white': !selected, 'bg-blue white': !selected && highlight}"
        class="sidebar_item_main hover-bg-blue hover-white cursor-pointer d-flex align-items-center justify-content-between mobile-listuser"
        @click="$emit('select', item)"
    >
        <div class="d-flex align-items-center assignee-userlist text-capitalize">
            <template v-if="item?.teamColor?.color">
                <span class="team_icon_span cursor-pointer text-center" :style="[{'color': item?.teamColor?.color,'background-color': item?.teamColor?.bgColor, 'padding':'5px'}]">{{item.label.charAt(0)}}</span>
            </template>
            <template v-if="item.image && !imageDisplayForPriority">
                <UserProfile
                    :showDot="false"
                    class="cursor-pointer mr-10px"
                    width="2"
                    :thumbnail="'25x25'"
                    :data="{
                        id: item.id,
                        title: item.label,
                        image: item.image || ''
                    }"
                />
            </template>
            <template v-if="item.image && imageDisplayForPriority">
                <img v-if="item.image.includes('http')" :title="item.title ? item.title : 'N/A'" :src="companyPrioritiesIcons(item.value).statusImage" alt="" :style="{width: '11px', height: '11px','margin-right': '10px','border-radius': '2px !important','vertical-align':'middle'}"/>
                <WasabiImage :style="{width: '10px', height: '10px'}" v-else :data="{title: item.title ? item.title : 'N/A', url: item.image, filename: item.image.split('/').pop(), extension: item.image.split('/').pop().split('.').pop()}"/>
            </template>
            <div :class="[{'d-flex align-items-center' : isDisable === true}]">
                <div v-if="isDisable === true && item.textColor" class="mr-10px border-radius-3-33-px" :style="[{'background-color': item?.textColor,height:'12px',width:'12px'}]"></div>
                <template v-if="item.taskImage && isDisable === true">
                    <TaskTypeIcon :taskType="item" class="sidebar__task-image" />
                </template>
                <span class="d-block emp_label" :class="[{'font-weight-400' : isDisable === true , 'font-weight-500 font-size-13' : isDisable === false, 'pl-5px': imageDisplayForPriority,'pl-10px' : taskType}]" :style="[{'font-size-13' : clientWidth > 767 &&  isDisable === true , 'font-size-16' : clientWidth <= 767 &&  isDisable === true }]">{{item.label}}</span>
                <span v-if="item.designation" class="font-size-12 d-block designationAssignee emp_label">{{item.designation ? item.designation : ''}}</span>
            </div>
        </div>

        <div class="d-flex align-items-center">
            <div v-if="isDisable === true ? (removeKey && removeKey.length > 0 ? !removeKey.includes(item.key) : (item.key !==2  && item.key !== 1)) : true" class="position-re conditional__item">
                <template v-if="isDefault === true ? (item.isDefault === false && item.count <= 0) : true">
                    <img v-if="selected && multiSelect" :src="closeRedImage" alt="" class="cursor-pointer" @click.stop="$emit('remove', item)">
                </template>
            </div>
            <div v-if="isDisable === true" class="ml-15px position-re d-none status__change-wrapper">
                <DropDown class="status_change_dropdown"  :bodyClass="{'status__renamecolordelete-dropdown' : true}">
                    <template #button>
                        <img :src="addIcon" alt="addIconmilestoneSvg" class="cursor-pointer">
                    </template>
                    <template #options>
                        <DropDownOption>
                            <img :src="clientWidth > 767 ? editIcon:editIcon2" class="mr-10px"> {{$t("Projects.rename")}}
                        </DropDownOption>
                        <DropDownOption>
                            <img :src="changeColor" class="mr-10px"> {{$t("Tags.change_color")}}
                        </DropDownOption>
                        <DropDownOption>
                            <img :src="deleteIcon" class="mr-10px"> {{$t('Projects.delete')}} {{$t('Projects.status')}}
                        </DropDownOption>
                    </template>
                </DropDown>
            </div>
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits , inject} from "vue";
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import { companyPrioritiesIcons } from '@/composable/commonFunction';
defineProps({
    item: {
        type: Object,
        required: true
    },
    multiSelect: {
        type: Boolean,
        default: false
    },
    visible: {
        type: Boolean,
        default: false
    },
    selected: {
        type: Boolean,
        default: false
    },
    highlight: {
        type: Boolean,
        default: false
    },
    isDisable:{
        type: Boolean,
        default : false
    },
    isDefault: {
        type: Boolean,
        default: false
    },
    imageDisplayForPriority: {
        type: Boolean,
        default: false
    },
    taskType: {
        type: Boolean,
        default: false
    },
    removeKey: {
        type: Array,
        default: () => []
    }
})

defineEmits(["select", "remove"])
const clientWidth = inject("$clientWidth");
const closeRedImage = require("@/assets/images/svg/delete_cross_icon.svg");
const addIcon = require("@/assets/images/svg/verticalDropdownthreedots.svg");
const editIcon = require("@/assets/images/svg/edit_icon.svg");
const editIcon2 = require("@/assets/images/svg/edit_rename_icon.svg");
const changeColor = require("@/assets/images/svg/change_color.svg");
const deleteIcon = require("@/assets/images/svg/redDelete_Icon.svg");
</script>

<style src="./style.css">
</style>