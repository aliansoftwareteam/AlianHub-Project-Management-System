<template>
    <div>
        <Sidebar
            :value="filterUsers.map((x) => ({value: x}))"
            :multiSelect="true"
            :enableSearch="true"
            :options="assigneeFilterOptions"
            :visible="userSidebar"
            @update:visible="(v) => $emit('update:userSidebar', v)"
            :title="$t('Projects.list_of_user')"
            @selected="$emit('manageFilterUsers', $event.value)"
            @itemClicked="$emit('manageFilterUsers', $event.value)"
            @removed="$emit('manageFilterUsers', $event.value)"
            @clear="$emit('clearFilterUsers')"
        />
        <Sidebar
            className="task-sub-sidebar"
            :visible="isSidebar"
            @update:visible="(v) => $emit('update:isSidebar', v)"
            :title="$t(`${sidebarTitle}`)"
            width="358px"
            :top="clientWidth <= 767 ? '0px' : '46px'"
        >
            <template #body>
                <FileAndLinks
                    v-if="sidebarTitle === $t('Projects.Files_&_Links')"
                    :attachments="projectData.attachments"
                    :description="projectData.description"
                    @closeSidebar="(val) => $emit('update:isSidebar', val)"
                    :handleType="'project'"
                    :selectedData="projectData"
                />
                <TaskAudioFiles
                    v-else-if="sidebarTitle === $t('Projects.audio_files')"
                    :key="`${projectData?._id}` + 'audiofiles'"
                    :fromWhich="'project'"
                    :selectedData="projectData"
                />
            </template>
        </Sidebar>
        <Sidebar
            :visible="showColorAvatar"
            @update:visible="(v) => { $emit('update:showColorAvatar', v); if(!v) $emit('resetFormData'); }"
            width="607px"
            :title="$t('Projects.change_color')"
        >
            <template #head-right>
                <div>
                    <button class="btn-primary p0x-10px" @click="$emit('saveAvatar')">{{ $t('Projects.save') }}</button>
                    <button class="outline-secondary p0x-10px ml-10px" @click="$emit('update:showColorAvatar', false)">{{ $t('Projects.cancel') }}</button>
                </div>
            </template>
            <template #body>
                <div class="bg-white p-1 m-1 border-radius-8-px">
                    <div v-if="savingAvatar" class="bg-blue position-ab z-index-1 h-100 w-100 saving__avtar-div">
                        <SpinnerComp :isSpinner="true"/>
                    </div>
                    <ProjectProfileForm
                        :modelValue="formData.projectProfileField"
                        @update:modelValue="(v) => $emit('updateFormData', v)"
                        :name="{value: formData.projectName} || {value: 'N/A'}"
                        @update:image="(ele) => $emit('updateImage', ele)"
                    />
                </div>
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import FileAndLinks from '@/components/molecules/FileAndLinks/FileAndLinks.vue';
import TaskAudioFiles from '@/components/molecules/TaskAudioFiles/TaskAudioFiles.vue';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import ProjectProfileForm from '@/components/templates/CreateProject/ProjectProfileForm.vue';

defineProps({
    filterUsers: { type: Array, default: () => [] },
    assigneeFilterOptions: { type: Array, default: () => [] },
    userSidebar: { type: Boolean, default: false },
    isSidebar: { type: Boolean, default: false },
    sidebarTitle: { type: String, default: '' },
    showColorAvatar: { type: Boolean, default: false },
    savingAvatar: { type: Boolean, default: false },
    formData: { type: Object, required: true },
    projectData: { type: Object, required: true },
    clientWidth: { type: Number, required: true },
});

defineEmits([
    'update:userSidebar',
    'update:isSidebar',
    'update:showColorAvatar',
    'manageFilterUsers',
    'clearFilterUsers',
    'resetFormData',
    'saveAvatar',
    'updateFormData',
    'updateImage',
]);
</script>
