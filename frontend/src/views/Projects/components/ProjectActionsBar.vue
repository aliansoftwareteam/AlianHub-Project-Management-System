<template>
    <div class="list-head-right">
        <ul class="d-flex align-items-center m-0 pab-row">
            <li v-if="clientWidth > 767 && canAutomate">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="project-automate" :title="$t('Projects.automate_title')" @click="openAutomate">
                    <ShellIcon name="automations" :size="14" />{{ $t('Projects.automate') }}
                </button>
            </li>
            <li v-if="clientWidth > 767">
                <button id="projectviewfiles_driver" type="button" class="ah-btn ah-btn--secondary ah-btn--sm ph2__icon-btn" :aria-label="$t('Projects.files_links')" :title="$t('Projects.files_links')" @click="$emit('openSidebar', 'filesLinks')">
                    <ShellIcon name="paperclip" :size="14" />
                </button>
            </li>
            <li v-if="clientWidth > 767">
                <button id="projectviewaudio_driver" type="button" class="ah-btn ah-btn--secondary ah-btn--sm ph2__icon-btn" :aria-label="$t('Projects.audio_files')" :title="$t('Projects.audio_files')" @click="$emit('openSidebar', 'audio')">
                    <ShellIcon name="mic" :size="14" />
                </button>
            </li>
            <li v-if="clientWidth > 767">
                <button
                    id="projectviewwatch_driver"
                    type="button"
                    class="ah-btn ah-btn--secondary ah-btn--sm ph2__watchers"
                    data-test="project-watchers"
                    :aria-label="$t('Projects.watchers_count', { n: watcherCount }, watcherCount)"
                    :title="$t('Projects.watchers')"
                    @click="$emit('openWatcher')"
                >
                    <ShellIcon name="eye" :size="14" />
                    <span class="ph2__count" aria-hidden="true">{{ watcherCount }}</span>
                </button>
            </li>
            <li :style="clientWidth > 767 ? null : { marginLeft: '20px' }" class="audio-list-wrapper">
                <DropDown mode="menu" maxHeight="64dvh" class="audio_dropdown" :bodyClass="{'assigneelist-audiofile-dropdown' : true}">
                    <template #head v-if="clientWidth <= 767">
                        <div class="mobiledropdown-projecttitleimage-wrapper">
                            <span v-if="projectData?.projectIcon && projectData?.projectIcon.type === 'color'" class="ah-letter-tile d-flex align-items-center justify-content-center ml-9px" :class="{'inital-box' : clientWidth > 767 , 'project-firtsleeter-box' : clientWidth <=767}" :style="[{'background-color': projectData?.projectIcon.data}]">{{ projectData?.ProjectName.charAt(0).toUpperCase() }}</span>
                            <template v-else-if="projectData?.projectIcon && projectData?.projectIcon?.type === 'image'">
                                <WasabiImage thumbnail="60x60" class="profile-sm-square mobile-projectlist-icon" v-if="!projectData.projectIcon.data.includes('http')" :data="{url: projectData.projectIcon.data, filename: projectData.projectIcon.data.split('/').pop(), extension: projectData.projectIcon.data.split('/').pop().split('.').pop()}"/>
                                <img v-else class="profile-sm-square mobile-projectlist-icon" :src="projectData.projectIcon.data" alt=""/>
                            </template>
                            <div class="list-text-wrapper">
                                <span class="text-ellipsis project-actions-bar-font-weight-bold black list-view-header-title ml-12px" @dblclick="$emit('startEditName')" :title="projectData.ProjectName">
                                    {{ projectData?.ProjectName }}
                                </span>
                            </div>
                        </div>
                    </template>
                    <template #button="{ triggerAttrs }">
                        <button
                            type="button"
                            :class="clientWidth > 767 ? 'ah-btn ah-btn--secondary ah-btn--sm ph2__icon-btn' : 'cursor-pointer dot-btn border-0'"
                            :aria-label="$t('Projects.more_features')"
                            :title="$t('Projects.more_features')"
                            v-bind="triggerAttrs"
                        >
                            <ShellIcon id="projectoptions_driver" name="more" :size="clientWidth > 767 ? 14 : 24" />
                        </button>
                    </template>
                    <template #options>
                        <div id="projectoptionslist_driver">
                            <div v-if="projectData?.isPrivateSpace && clientWidth <= 767" class="d-flex align-items-center project-actions-bar-hover-bg-lighter-gray-dropdown project-actions-bar-hover-purple cursor-pointer text-nowrap drop-down-item gray81 p-7px project-actions-bar-bg-gray91 border-radius-8-px border-bottom mb-20px">
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
                                    <div :class="rowClass">
                                        <ShellIcon name="eye" :size="iconSize" />
                                        <span>{{ $t('Projects.watchers') }}</span>
                                        <span class="pab-count" aria-hidden="true">{{ watcherCount }}</span>
                                    </div>
                                </DropDownOption>
                                <DropDownOption @click="$emit('openSidebar', 'filesLinks')">
                                    <div :class="rowClass">
                                        <ShellIcon name="paperclip" :size="iconSize" />
                                        <span>{{ $t('Projects.files_links') }}</span>
                                    </div>
                                </DropDownOption>
                                <DropDownOption @click="$emit('openSidebar', 'audio')">
                                    <div :class="rowClass">
                                        <ShellIcon name="mic" :size="iconSize" />
                                        <span>{{ $t('Projects.audio_files') }}</span>
                                    </div>
                                </DropDownOption>
                            </template>
                            <DropDownOption v-if="clientWidth <= 767 && canAutomate" data-test="project-automate-menu" @click="openAutomate">
                                <div :class="rowClass">
                                    <ShellIcon name="automations" :size="iconSize" />
                                    <span>{{ $t('Projects.automate') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$emit('openPermissionSidebar')" v-if="checkPermission('settings.settings_security_permissions') !== null">
                                <div :class="rowClass">
                                    <ShellIcon name="lock" :size="iconSize" />
                                    <span>{{ $t('Projects.project_permissions') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$emit('startEditName')" v-if="checkPermission('project.project_name_edit',projectData.isGlobalPermission) === true">
                                <div :class="rowClass">
                                    <ShellIcon name="edit" :size="iconSize" />
                                    <span>{{ $t('Projects.rename') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$emit('openColorAvatar')" v-if="checkPermission('project.project_create',projectData.isGlobalPermission) === true">
                                <div :class="rowClass">
                                    <ShellIcon name="palette" :size="iconSize" />
                                    <span>{{ $t('Projects.color_avatar') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="canDuplicate" data-test="duplicate-project" @click="duplicating = true">
                                <div :class="rowClass">
                                    <ShellIcon name="copy" :size="iconSize" />
                                    <span>{{ $t('Projects.duplicate_project') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="canDuplicate" data-test="save-project-template" @click="savingTemplate = true">
                                <div :class="rowClass">
                                    <ShellIcon name="template" :size="iconSize" />
                                    <span>{{ $t('Projects.template_save_entry') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption @click="$emit('archiveProject', 0)" v-if="checkPermission('project.project_close',projectData.isGlobalPermission) === true">
                                <div :class="rowClass">
                                    <ShellIcon name="xCircle" :size="iconSize" />
                                    <span>{{ $t('Projects.close_project') }}</span>
                                </div>
                            </DropDownOption>
                            <DropDownOption v-if="checkPermission('project.project_delete',projectData.isGlobalPermission) === true" @click="$emit('archiveProject', 2)">
                                <div :class="[rowClass, 'ah-menu-row--danger']">
                                    <ShellIcon name="trash" :size="iconSize" />
                                    <span>{{ $t('Projects.delete') }}</span>
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

const { checkPermission } = useCustomComposable();

const props = defineProps({
    projectData: { type: Object, required: true },
    clientWidth: { type: Number, required: true },
    users: { type: Array, default: () => [] },
    teams: { type: Array, default: () => [] },
});

const watcherCount = computed(() => Object.keys(props.projectData?.watchers || {}).length);
const rowClass = computed(() => ['ah-menu-row', { 'ah-menu-row--phone': props.clientWidth <= 767 }]);
const iconSize = computed(() => (props.clientWidth <= 767 ? 18 : 15));

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
</script>

<style scoped>
.pab-row { gap: var(--sp-2); }
.pab-count { margin-left: auto; font: 600 var(--fs-xs, 10.5px)/1 var(--font-mono); color: var(--ink-2); }
</style>

<style scoped>
.project-actions-bar-hover-purple:hover {
    color: var(--brand) !important;
}
.project-actions-bar-bg-gray91 {
    background-color: var(--fill);
}
.project-actions-bar-hover-bg-lighter-gray-dropdown:hover {
    background-color: var(--surface-hover) !important;
}
.project-actions-bar-font-weight-bold {
    font-weight: bold;
}
</style>
