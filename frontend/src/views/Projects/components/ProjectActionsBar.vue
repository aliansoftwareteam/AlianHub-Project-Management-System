<template>
    <div class="list-head-right">
        <ul class="d-flex align-items-center m-0">
            <li v-if="clientWidth > 767 && checkApps('AI',projectData) && checkPermission('artificial_intelligence',projectData?.isGlobalPermission) === true" class="mr-10px">
                <img @click="$emit('openDevChat')" id="projectviewdevchat_driver" :src="devChatIcon" :title="$t('DevAgent.open_ai_developer')" alt="AI Developer" class="cursor-pointer"/>
            </li>
            <li v-if="clientWidth > 767">
                <img @click="$emit('openSidebar', 'filesLinks')" id="projectviewfiles_driver" :src="fileLinks" class="cursor-pointer"/>
            </li>
            <li class="ml-10px" v-if="clientWidth > 767" :class="clientWidth>767 ? 'mr-10px' : 'm-0'">
                <img @click="$emit('openSidebar', 'audio')" id="projectviewaudio_driver" :src="audio" alt="audio" class="cursor-pointer"/>
            </li>
            <li v-if="clientWidth > 767">
                <div class="position-re">
                    <a href.prevent="#" @click="$emit('openWatcher')" class="d-flex align-items-center justify-content-center border border-radius-5-px open__watcher cursor-pointer">
                        <img id="projectviewwatch_driver" :src="eyeIcon">
                    </a>
                    <span class="sprint-watcher-count">{{ Object.keys(projectData?.watchers || {})?.length || 0 }}</span>
                </div>
            </li>
            <li :style="[{marginLeft : clientWidth > 767 ? '1rem' : '20px'}]" class="audio-list-wrapper">
                <DropDown maxHeight="64dvh" class="audio_dropdown" :bodyClass="{'assigneelist-audiofile-dropdown' : true}">
                    <template #head v-if="clientWidth <= 767">
                        <div class="mobiledropdown-projecttitleimage-wrapper">
                            <span v-if="projectData?.projectIcon && projectData?.projectIcon.type === 'color'" class="d-flex align-items-center justify-content-center ml-9px" :class="{'inital-box' : clientWidth > 767 , 'project-firtsleeter-box' : clientWidth <=767}" :style="[{'background-color': projectData?.projectIcon.data}]">{{ projectData?.ProjectName.charAt(0).toUpperCase() }}</span>
                            <template v-else-if="projectData?.projectIcon && projectData?.projectIcon?.type === 'image'">
                                <WasabiImage thumbnail="60x60" class="profile-sm-square mobile-projectlist-icon" v-if="!projectData.projectIcon.data.includes('http')" :data="{url: projectData.projectIcon.data, filename: projectData.projectIcon.data.split('/').pop(), extension: projectData.projectIcon.data.split('/').pop().split('.').pop()}"/>
                                <img v-else class="profile-sm-square mobile-projectlist-icon" :src="projectData.projectIcon.data" alt=""/>
                            </template>
                            <div class="list-text-wrapper">
                                <span class="text-ellipsis font-weight-bold text-capitalize black list-view-header-title ml-12px" @dblclick="$emit('startEditName')" :title="projectData.ProjectName">
                                    {{ projectData?.ProjectName }}
                                </span>
                            </div>
                        </div>
                    </template>
                    <template #button>
                        <button class="cursor-pointer dot-btn border-0" :ref="`projectdd_${projectData._id || ''}`">
                            <img :src="clientWidth > 767 ? horizontalDots : horizontalDotsMobile" id="projectoptions_driver"/>
                        </button>
                    </template>
                    <template #options>
                        <div id="projectoptionslist_driver">
                            <DropDownOption v-if="projectData?.isPrivateSpace && clientWidth <= 767" class="border-bottom mb-20px">
                                <Assignee
                                    class="assignee-data ml-15px"
                                    :users="projectData.AssigneeUserId"
                                    :options="[...users.map((x) => x._id), ...teams.map((x) => 'tId_'+x._id)]"
                                    :imageWidth="clientWidth>1024 ? '30px' : '25px'"
                                    :num-of-users="clientWidth>1024 ? 4 : 2"
                                    :addUser="checkPermission('project.project_assignee',projectData.isGlobalPermission) === true"
                                    :showAddUser="true"
                                    @selected="$emit('changeAssignee', 'add', $event)"
                                    @removed="$emit('changeAssignee', 'remove', $event)"
                                    :isDisplayTeam="true"
                                    :z-index-assigne="8"
                                />
                            </DropDownOption>
                            <template v-if="clientWidth <= 767">
                                <DropDownOption v-if="checkApps('AI',projectData) && checkPermission('artificial_intelligence',projectData?.isGlobalPermission) === true" @click="$refs[`projectdd_${projectData._id || ''}`].click(); $emit('openDevChat')">
                                    <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                        <div class="d-flex align-items-center">
                                            <img :src="devChatIcon" class="mr-20px" alt="AI Developer"/>
                                        </div>
                                        <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('DevAgent.ai_developer') }}</span>
                                    </div>
                                </DropDownOption>
                                <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(); $emit('openWatcher')">
                                    <div :style="[{padding : clientWidth <= 767 ? '10px 0px !important' : '3.5px 10px !important'}]" class="d-flex align-items-center">
                                        <div class="position-re mr-15px">
                                            <div class="d-flex align-items-center justify-content-center border border-radius-5-px open__watcher">
                                                <img :src="eyeIcon">
                                            </div>
                                            <span class="sprint-watcher-count">{{ Object.keys(projectData?.watchers || {})?.length || 0 }}</span>
                                        </div>
                                        <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.watchers') }}</span>
                                    </div>
                                </DropDownOption>
                                <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(); $emit('openSidebar', 'filesLinks')">
                                    <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                        <div class="d-flex align-items-center">
                                            <img :src="fileLink" class="mr-20px"/>
                                        </div>
                                        <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.files_links') }}</span>
                                    </div>
                                </DropDownOption>
                                <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(); $emit('openSidebar', 'audio')" class="border-bottom pb-20px">
                                    <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                        <div class="d-flex align-items-center">
                                            <img :src="audioLinkMobile" class="mr-20px"/>
                                        </div>
                                        <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.audio_files') }}</span>
                                    </div>
                                </DropDownOption>
                            </template>
                            <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(); $emit('openPermissionSidebar')" v-if="checkPermission('settings.settings_security_permissions') !== null">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <img :src="lockIcon" alt="lockIcon" class="mr-20px">
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.project_permissions') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(); $emit('startEditName')" v-if="checkPermission('project.project_name_edit',projectData.isGlobalPermission) === true">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <img :src="listIcon" alt="listIcon" class="mr-20px">
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.rename') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(); $emit('openColorAvatar')" v-if="checkPermission('project.project_create',projectData.isGlobalPermission) === true">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <img :src="colorPalletIcon" alt="colorPalletIcon" class="mr-20px">
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.color_avatar') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$refs[`projectdd_${projectData._id || ''}`].click(); $emit('archiveProject', 0)" v-if="checkPermission('project.project_close',projectData.isGlobalPermission) === true">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <img :src="cancelIcon" alt="cancelIcon" class="mr-20px">
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.close_project') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="checkPermission('project.project_delete',projectData.isGlobalPermission) === true" @click="$refs[`projectdd_${projectData._id || ''}`].click(); $emit('archiveProject', 2)">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <img :src="deleteIcon" alt="deleteIcon" class="mr-20px">
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.delete') }}</span>
                                </div>
                            </DropDownOption>
                        </div>
                    </template>
                </DropDown>
            </li>
        </ul>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import WasabiImage from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
import { useCustomComposable } from '@/composable';

const { checkPermission, checkApps } = useCustomComposable();

defineProps({
    projectData: { type: Object, required: true },
    clientWidth: { type: Number, required: true },
    users: { type: Array, default: () => [] },
    teams: { type: Array, default: () => [] },
});

defineEmits(['openSidebar', 'openWatcher', 'openDevChat', 'changeAssignee', 'openPermissionSidebar', 'startEditName', 'openColorAvatar', 'archiveProject']);

const fileLinks = require('@/assets/images/svg/Fileslinks.svg');
const devChatIcon = require('@/assets/images/svg/AiDeveloper.svg');
const audio = require('@/assets/images/svg/Voice_Record.svg');
const audioLinkMobile = require('@/assets/images/svg/AudioLink.svg');
const fileLink = require('@/assets/images/svg/Files_links.svg');
const eyeIcon = require('@/assets/images/svg/PriorityIcon/watchProjectEye.svg');
const horizontalDots = require('@/assets/images/svg/horizontalDots.svg');
const horizontalDotsMobile = require('@/assets/images/svg/threedot_mobile_list.svg');
const lockIcon = require('@/assets/images/lock.png');
const listIcon = require('@/assets/images/svg/edit_rename_icon.svg');
const colorPalletIcon = require('@/assets/images/svg/palette.svg');
const cancelIcon = require('@/assets/images/svg/cancel.svg');
const deleteIcon = require('@/assets/images/svg/Delete_Icon.svg');
</script>
