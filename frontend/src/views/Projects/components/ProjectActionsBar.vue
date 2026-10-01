<template>
    <div class="list-head-right">
        <ul class="d-flex align-items-center m-0">
            <li v-if="clientWidth > 767 && canAutomate" class="mr-10px">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="project-automate" :title="$t('Projects.automate_title')" @click="openAutomate">
                    <ShellIcon name="automations" :size="14" />{{ $t('Projects.automate') }}
                </button>
            </li>
            <li v-if="clientWidth > 767">
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Projects.files_links')" :title="$t('Projects.files_links')" @click="$emit('openSidebar', 'filesLinks')">
                    <img id="projectviewfiles_driver" :src="fileLinks" alt="" aria-hidden="true"/>
                </button>
            </li>
            <li class="ml-10px" v-if="clientWidth > 767" :class="clientWidth>767 ? 'mr-10px' : 'm-0'">
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Projects.audio_files')" :title="$t('Projects.audio_files')" @click="$emit('openSidebar', 'audio')">
                    <img id="projectviewaudio_driver" :src="audio" alt="" aria-hidden="true"/>
                </button>
            </li>
            <li v-if="clientWidth > 767">
                <div class="position-re">
                    <button
                        type="button"
                        class="d-flex align-items-center justify-content-center border border-radius-5-px open__watcher cursor-pointer"
                        :aria-label="$t('Projects.watchers_count', { n: watcherCount }, watcherCount)"
                        :title="$t('Projects.watchers')"
                        @click="$emit('openWatcher')"
                    >
                        <img id="projectviewwatch_driver" :src="eyeIcon" alt="" aria-hidden="true">
                    </button>
                    <span class="sprint-watcher-count" aria-hidden="true">{{ watcherCount }}</span>
                </div>
            </li>
            <li :style="[{marginLeft : clientWidth > 767 ? '1rem' : '20px'}]" class="audio-list-wrapper">
                <DropDown mode="menu" maxHeight="64dvh" class="audio_dropdown" :bodyClass="{'assigneelist-audiofile-dropdown' : true}">
                    <template #head v-if="clientWidth <= 767">
                        <div class="mobiledropdown-projecttitleimage-wrapper">
                            <span v-if="projectData?.projectIcon && projectData?.projectIcon.type === 'color'" class="d-flex align-items-center justify-content-center ml-9px" :class="{'inital-box' : clientWidth > 767 , 'project-firtsleeter-box' : clientWidth <=767}" :style="[{'background-color': projectData?.projectIcon.data}]">{{ projectData?.ProjectName.charAt(0).toUpperCase() }}</span>
                            <template v-else-if="projectData?.projectIcon && projectData?.projectIcon?.type === 'image'">
                                <WasabiImage thumbnail="60x60" class="profile-sm-square mobile-projectlist-icon" v-if="!projectData.projectIcon.data.includes('http')" :data="{url: projectData.projectIcon.data, filename: projectData.projectIcon.data.split('/').pop(), extension: projectData.projectIcon.data.split('/').pop().split('.').pop()}"/>
                                <img v-else class="profile-sm-square mobile-projectlist-icon" :src="projectData.projectIcon.data" alt=""/>
                            </template>
                            <div class="list-text-wrapper">
                                <span class="text-ellipsis font-weight-bold black list-view-header-title ml-12px" @dblclick="$emit('startEditName')" :title="projectData.ProjectName">
                                    {{ projectData?.ProjectName }}
                                </span>
                            </div>
                        </div>
                    </template>
                    <template #button="{ triggerAttrs }">
                        <button type="button" class="cursor-pointer dot-btn border-0" :aria-label="$t('Projects.more_features')" :title="$t('Projects.more_features')" v-bind="triggerAttrs">
                            <ShellIcon id="projectoptions_driver" name="more" :size="clientWidth > 767 ? 20 : 24" />
                        </button>
                    </template>
                    <template #options>
                        <div id="projectoptionslist_driver">
                            <div v-if="projectData?.isPrivateSpace && clientWidth <= 767" class="d-flex align-items-center hover-bg-lighter-gray-dropdown hover-purple cursor-pointer text-nowrap drop-down-item gray81 p-7px bg-gray91 border-radius-8-px border-bottom mb-20px">
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
                            </div>
                            <template v-if="clientWidth <= 767">
                                <DropDownOption @click="$emit('openWatcher')">
                                    <div :style="[{padding : clientWidth <= 767 ? '10px 0px !important' : '3.5px 10px !important'}]" class="d-flex align-items-center">
                                        <div class="position-re mr-15px">
                                            <div class="d-flex align-items-center justify-content-center border border-radius-5-px open__watcher">
                                                <img :src="eyeIcon" alt="">
                                            </div>
                                            <span class="sprint-watcher-count" aria-hidden="true">{{ watcherCount }}</span>
                                        </div>
                                        <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.watchers') }}</span>
                                    </div>
                                </DropDownOption>
                                <DropDownOption @click="$emit('openSidebar', 'filesLinks')">
                                    <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                        <div class="d-flex align-items-center">
                                            <img :src="fileLink" alt="" class="mr-20px"/>
                                        </div>
                                        <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.files_links') }}</span>
                                    </div>
                                </DropDownOption>
                                <DropDownOption @click="$emit('openSidebar', 'audio')" class="border-bottom pb-20px">
                                    <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                        <div class="d-flex align-items-center">
                                            <img :src="audioLinkMobile" alt="" class="mr-20px"/>
                                        </div>
                                        <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.audio_files') }}</span>
                                    </div>
                                </DropDownOption>
                            </template>
                            <DropDownOption v-if="clientWidth <= 767 && canAutomate" data-test="project-automate-menu" @click="openAutomate">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options project_detail_dropdown_wrapper">
                                    <div class="d-flex align-items-center mr-20px">
                                        <ShellIcon name="automations" :size="18" />
                                    </div>
                                    <span class="font-size-16 font-weight-400 gray4b">{{ $t('Projects.automate') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$emit('openPermissionSidebar')" v-if="checkPermission('settings.settings_security_permissions') !== null">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <span class="ah-mask-icon mr-20px" :style="maskOf(lockIcon)" aria-hidden="true"></span>
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.project_permissions') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$emit('startEditName')" v-if="checkPermission('project.project_name_edit',projectData.isGlobalPermission) === true">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <img :src="listIcon" alt="" class="mr-20px">
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.rename') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$emit('openColorAvatar')" v-if="checkPermission('project.project_create',projectData.isGlobalPermission) === true">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <img :src="colorPalletIcon" alt="" class="mr-20px">
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.color_avatar') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="canDuplicate" data-test="duplicate-project" @click="duplicating = true">
                                <div class="pab-duplicate" :class="{ 'pab-duplicate--phone': clientWidth <= 767 }">
                                    <ShellIcon name="copy" :size="clientWidth <= 767 ? 18 : 15" />
                                    <span>{{ $t('Projects.duplicate_project') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="canDuplicate" data-test="save-project-template" @click="savingTemplate = true">
                                <div class="pab-duplicate" :class="{ 'pab-duplicate--phone': clientWidth <= 767 }">
                                    <ShellIcon name="star" :size="clientWidth <= 767 ? 18 : 15" />
                                    <span>{{ $t('Projects.template_save_entry') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$emit('archiveProject', 0)" v-if="checkPermission('project.project_close',projectData.isGlobalPermission) === true">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <img :src="cancelIcon" alt="" class="mr-20px">
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.close_project') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="checkPermission('project.project_delete',projectData.isGlobalPermission) === true" @click="$emit('archiveProject', 2)">
                                <div class="d-flex align-items-center project-mobile-desc avtar-options" :class="`${clientWidth <= 767 ? 'project_detail_dropdown_wrapper' : ''}`">
                                    <div class="d-flex align-items-center">
                                        <img :src="deleteIcon" alt="" class="mr-20px">
                                    </div>
                                    <span :class="{'font-size-16': clientWidth <= 767 }" class="font-weight-400 gray4b">{{ $t('Projects.delete') }}</span>
                                </div>
                            </DropDownOption>
                        </div>
                    </template>
                </DropDown>
            </li>
        </ul>
        <DuplicateProjectDialog v-if="duplicating" :project="projectData" @close="duplicating = false" />
        <SaveProjectTemplateDialog v-if="savingTemplate" :project="projectData" @close="savingTemplate = false" />
    </div>
</template>

<script setup>
import { computed, defineProps, defineEmits, ref } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import WasabiImage from '@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue';
import DuplicateProjectDialog from '@/components/molecules/DuplicateProjectDialog/DuplicateProjectDialog.vue';
import SaveProjectTemplateDialog from '@/components/molecules/SaveProjectTemplateDialog/SaveProjectTemplateDialog.vue';
import { useCustomComposable } from '@/composable';
import { maskOf } from '@/utils/iconMask';

const { checkPermission } = useCustomComposable();

const props = defineProps({
    projectData: { type: Object, required: true },
    clientWidth: { type: Number, required: true },
    users: { type: Array, default: () => [] },
    teams: { type: Array, default: () => [] },
});

const watcherCount = computed(() => Object.keys(props.projectData?.watchers || {}).length);

/* The server judges a duplicate and a template on the company's rules, as it does a create, so the project's own rules are not read here. */
const canDuplicate = computed(() => props.projectData?.isPersonal !== true && checkPermission('project.project_create') === true);
const duplicating = ref(false);
const savingTemplate = ref(false);

const { getters } = useStore();
const route = useRoute();
const router = useRouter();
/* The same owner-or-admin check the automations page and the server apply. */
const canAutomate = computed(() => [1, 2].includes(Number(getters['settings/companyUserDetail']?.roleType)));
const openAutomate = () => router.push({
    name: 'Automations',
    params: { cid: route.params.cid },
    query: { templates: '1', project: String(props.projectData._id) },
});

defineEmits(['openSidebar', 'openWatcher', 'changeAssignee', 'openPermissionSidebar', 'startEditName', 'openColorAvatar', 'archiveProject']);

const fileLinks = require('@/assets/images/svg/Fileslinks.svg');
const audio = require('@/assets/images/svg/Voice_Record.svg');
const audioLinkMobile = require('@/assets/images/svg/AudioLink.svg');
const fileLink = require('@/assets/images/svg/Files_links.svg');
const eyeIcon = require('@/assets/images/svg/PriorityIcon/watchProjectEye.svg');
const lockIcon = require('@/assets/images/lock.png');
const listIcon = require('@/assets/images/svg/edit_rename_icon.svg');
const colorPalletIcon = require('@/assets/images/svg/palette.svg');
const cancelIcon = require('@/assets/images/svg/cancel.svg');
const deleteIcon = require('@/assets/images/svg/Delete_Icon.svg');
</script>

<style scoped>
.pab-duplicate { display: flex; align-items: center; gap: 20px; font-size: 12px; font-weight: 400; color: var(--ink-2); }
.pab-duplicate--phone { height: 50px; font-size: 16px; color: var(--ink); }
</style>
