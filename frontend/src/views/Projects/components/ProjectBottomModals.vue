<template>
    <div>
        <DropDown title="All Views" :ref="projectAddView" :bodyClass="{'viewlist-mobile-dropdown-new' : true}" maxHeight="unset" v-if="clientWidth <= 768">
            <template #button>
                <span ref="all_views_dd"></span>
            </template>
            <template #options>
                <div>
                    <ViewsDropdown @handleCloseDropdown="$refs.all_views_dd.click()" :projectData="projectData"/>
                </div>
            </template>
        </DropDown>

        <ProjectWatcher
            :openSidebar="openProjectWatcher"
            @update:openSidebar="(v) => $emit('update:openProjectWatcher', v)"
            :watchers="projectData?.watchers"
            :options="projectData?.isPrivateSpace ? projectData?.AssigneeUserId : users.map((x) => x._id)"
            :projectId="projectData?._id || ''"
        />
        <ConfirmationSidebar
            :modelValue="showSidebar"
            @update:modelValue="(v) => $emit('update:showSidebar', v)"
            :title="`${archive === 0 ? $t('Projects.close') : archive === 1 ? $t('Projects.archive') : $t('Projects.delete')}`"
            :message="archive === 0 ? $t('conformationmsg.archive0mesg') : archive === 1 ? $t('conformationmsg.archive') : $t('conformationmsg.delete')"
            :confirmationString="`${archive === 0 ? 'close' : archive === 1 ? 'archive' : 'delete'}`"
            :acceptButtonClass="archive === 1 ? 'btn-primary' : 'btn-danger'"
            :acceptButton="`${archive === 0 ? $t('Projects.close') : archive === 1 ? $t('Projects.archive') : $t('Projects.delete')}`"
            @confirm="$emit('confirmArchive')"
            :showSpinner="showSpinner"
        />
        <CreateProjectSidebar
            v-if="isActiveCreateSidebar"
            :isAdvanceFilterApplied="isAdvanceFilterApplied"
            :isActiveCreateSidebar="isActiveCreateSidebar"
            @click:closeSidebar="(v) => $emit('closeCreateSidebar', v)"
            @closeSidebar="(v) => $emit('closeCreateSidebar', v)"
        />
        <AiProjectCreator
            v-if="isActiveAiCreator"
            :visible="isActiveAiCreator"
            @close="$emit('closeAiCreator')"
            @created="(p) => $emit('aiProjectCreated', p)"
        />
        <ProjectPermission
            v-if="permissionSidebar"
            @isClose="(v) => $emit('update:permissionSidebar', !v)"
            :projectData="projectData"
        />
        <ConfirmModal
            className="projecttourend_driver_modal"
            :modelValue="showDriverSidebar"
            :acceptButtonText="$t('Tour.watch_video')"
            :cancelButtonText="$t('Projects.cancel')"
            :header="false"
            :cancelButton="false"
            :showCloseIcon="false"
            :footer="false"
            @accept="$emit('tourModalAccept')"
            @close="$emit('tourModalClose')"
        >
            <template #body>
                <div class="d-flex flex-column justify-content-center align-items-center position-re">
                    <div class="position-ab tourendmodal__close_button">
                        <img :src="cancelIconForTour" class="cursor-pointer cancel__icon-img tourendmodal__close_img" alt="close" @click.prevent="$emit('tourModalClose')">
                    </div>
                    <div>
                        <img :src="tourModalImage" alt="tourmodalimage">
                    </div>
                    <div class="text-center">
                        <h1>{{ $t('Tour.tour_completed') }}</h1>
                    </div>
                </div>
            </template>
        </ConfirmModal>
        <AISidebar v-if="openAiSidebar" @closeAi="$emit('closeAiSidebar')"></AISidebar>
        <!-- Keyed on the project: this bar outlives every project/sprint/task route
             change, so without the key a project switch would show the previous
             project's threads. -->
        <ProjectDevChat
            :key="`${projectData?._id || ''}-devchat`"
            :modelValue="openDevChat"
            :projectData="projectData"
            @update:modelValue="(v) => $emit('update:openDevChat', v)"
        />
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import ViewsDropdown from '@/components/molecules/ProjectViews/ViewsDropdown.vue';
import ProjectWatcher from '@/components/organisms/ProjectWatcher/ProjectWatcher.vue';
import ConfirmationSidebar from '@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue';
import CreateProjectSidebar from '@/components/organisms/CreateProject/CreateProjectSidebar.vue';
import AiProjectCreator from '@/components/organisms/AiProjectCreator/AiProjectCreator.vue';
import ProjectPermission from '@/components/atom/ProjectPermission/ProjectPermission.vue';
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import AISidebar from '@/components/molecules/AISidebar/AISidebar.vue';
import ProjectDevChat from '@/components/organisms/ProjectDevChat/ProjectDevChat.vue';

defineProps({
    clientWidth: { type: Number, required: true },
    projectAddView: { type: String, default: '' },
    projectData: { type: Object, required: true },
    users: { type: Array, default: () => [] },
    openProjectWatcher: { type: Boolean, default: false },
    showSidebar: { type: Boolean, default: false },
    archive: { type: Number, default: 0 },
    showSpinner: { type: Boolean, default: false },
    isActiveCreateSidebar: { type: Boolean, default: false },
    isAdvanceFilterApplied: { type: Boolean, default: false },
    isActiveAiCreator: { type: Boolean, default: false },
    permissionSidebar: { type: Boolean, default: false },
    showDriverSidebar: { type: Boolean, default: false },
    openAiSidebar: { type: Boolean, default: false },
    openDevChat: { type: Boolean, default: false },
});

defineEmits([
    'update:openProjectWatcher',
    'update:showSidebar',
    'confirmArchive',
    'closeCreateSidebar',
    'closeAiCreator',
    'aiProjectCreated',
    'update:permissionSidebar',
    'tourModalAccept',
    'tourModalClose',
    'closeAiSidebar',
    'update:openDevChat',
]);

const cancelIconForTour = require('@/assets/images/cancel_icon.png');
const tourModalImage = require('@/assets/images/tourmodalimage.png');
</script>
