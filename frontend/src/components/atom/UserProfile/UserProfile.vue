<template lang="">
    <div class="position-re setting_project-owner" :style="{width: width, height: width}">
        <template v-if="!data.type || data.type === 'user'">
            <template v-if="data.image">
                 <img v-if="data.image?.includes('http')" :title="data.title ? data.title : 'N/A'" class="profile-image asignee-profile" :class="{ 'border-red': isBorder }" :src="data.image" :alt="altText" :style="{width: width, height: width}"/>
                 <WasabiImage :style="{width: width, height: width}" v-else :userImage="true" :alt="altText" class="profile-image asignee-profile" :data="{title: data.title ? data.title : 'N/A', url: data?.image, filename: data?.image?.split('/').pop(), extension: data.image?.split('/').pop().split('.').pop()}" :thumbnail="thumbnail"/>
             </template>
             <template v-else>
                <img :title="data.title ? data.title : 'N/A'" 
                class="profile-image asignee-profile"
                :class="{ 'border-red': isBorder }"
                :src="defaultUserAvatar"
                :alt="altText"
                :style="{width: width, height: width}" />
             </template>
            <img v-if="showDot" :src="data.isOnline ? onlineDot : offlineDot" alt="user status" class="user-status"/>
        </template>
        <template v-if="data.type && data.type === 'team'">
            <div class="cursor-pointer text-center profile-image font-size-15" :title="data.title ? data.title : 'N/A'" :style="[{'color': data?.teamColor?.color,'background-color': data?.teamColor?.bgColor, 'padding':'5px', width: width, height: width}]">{{data.title ? data.title.charAt(0): data.label.charAt(0)}}</div>
        </template>
    </div>
</template>
<script setup>
import { computed, defineProps, inject } from "vue";
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue"

const onlineDot = require("@/assets/images/png/greenDot.png");
const offlineDot = require("@/assets/images/png/redDot.png");
const defaultUserAvatar = inject("$defaultUserAvatar")

const props = defineProps({
    data: {
        type: Object,
        default: () => {}
    },
    showDot: {
        type: Boolean,
        default: true
    },
    width: {
        type: String,
        default: "50px"
    },
    thumbnail: {
        type: String,
    },
    isBorder: {
        type: Boolean,
        default: true
    },
    /* Set where the person's name is written beside the picture, so it is not read out twice. */
    decorative: {
        type: Boolean,
        default: false
    }
})

const altText = computed(() => (props.decorative ? '' : (props.data?.title || '')));

</script>
<style>
@import "./style.css";
</style>