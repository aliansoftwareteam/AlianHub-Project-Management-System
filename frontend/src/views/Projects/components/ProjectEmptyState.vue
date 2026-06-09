<template>
    <div class="bg-light-gray d-flex align-items-center justify-content-center flex-column w-100 h-100">
        <img :src="noProjectsIcon" alt="noProjectsIcon">
        <template v-if="!showArchivedProjects">
            <h2>{{ $t('ProjectSlider.you_dont') }}</h2>
            <div v-if="canCreate && !isFilterHasData">
                <button class="outline-primary ml-1 font-size-16 p0x-13px" @click="$emit('createProject')">+ {{ $t('ProjectSlider.new_project') }}</button>
                <button v-if="currentCompany?.planFeature?.aiPermission" class="btn btn-primary ml-1 font-size-16 p0x-13px" @click="$emit('createAiProject')">{{ aiButtonLabel }}</button>
            </div>
        </template>
        <template v-else>
            <h2>{{ $t('ProjectSlider.no_archived') }}</h2>
            <button class="outline-primary" @click="$emit('hideArchive')">{{ $t('ProjectSlider.hide_archive') }}</button>
        </template>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

defineProps({
    showArchivedProjects: { type: Boolean, default: false },
    canCreate: { type: Boolean, default: false },
    isFilterHasData: { type: Boolean, default: false },
    currentCompany: { type: Object, default: () => ({}) },
});

defineEmits(['createProject', 'createAiProject', 'hideArchive']);

const noProjectsIcon = require('@/assets/images/svg/No-Search-Result.svg');
const aiButtonLabel = '✨ Create with AI';
</script>
