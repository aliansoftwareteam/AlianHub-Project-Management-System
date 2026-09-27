<template>
    <div >
        <div class="screnshotpreviewHover bg-white">
            <div class="screnshotpreviewHover__taskNameKey bg-light-gray">
                <div class="d-flex flex-wrap screnshotpreviewHover__taskNameKey--propjectDetail align-items-center justify-content-center font-ui gray text-center">
                    {{dataObj.projectKey}}  |  {{dataObj.projectName}}  / 
                    <span><img class="folderIconImg" v-if="dataObj.isFolderSprint === true" src="@/assets/images/folder.png"> {{dataObj.folderName}} {{dataObj.isFolderSprint === true ? '/' : ''}} </span>
                    {{dataObj.sprintName}}
                </div>
                <div class="d-flex screnshotpreviewHover__taskNameKey--taskName justify-content-around black font-ui text-ellipsis font-size-12 font-weight-500 text-center">{{dataObj.taskName}}</div>
            </div>
            <div class="screnshotpreviewHover__Discription d-flex align-items-center justify-content-between py-8px">
                <span class="screnshotpreviewHover__Discription--memoname font-ui GunPowder text-ellipsis font-size-12 gray pr-10px mw-50">{{dataObj.memoName}}</span>
                <span class="d-flex align-items-center">
                    <UserProfile
                        :showDot="false"
                        :data="{
                            image: dataObj.userProfile,
                            title: dataObj.userName
                        }"
                        width="20px"
                        :thumbnail="'20x20'"
                        class="cursor-pointer timelog-user-status"
                    />
                    <span class="font-size-12 gray ml-10px">{{dataObj.userName}}</span>
                </span>
            </div>
            <div v-if="dataObj?.trackShots?.deleted">
                <img class="screnshotpreviewHover__image--open" src='@/assets/images/svg/deleted-placeholder.svg'>
            </div>
            <div v-else class="screnshotpreviewHover__image">
                <img class="screnshotpreviewHover__image--open" v-if="dataObj.image.includes('http')" :src="dataObj.image">
                <WasabiImage v-else class="screnshotpreviewHover__image--open border-radius-10-px" :data="{url: dataObj.image}" />
            </div>
        </div>
    </div>
</template>
<script setup>
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import { ref,watch } from "vue"
const props = defineProps({
    data: {type: Object},
    index: {type: Number}
})
const dataObj = ref(props.data)
watch(() => props.data , (val)=>{
    dataObj.value = val;
})
</script>
<style scoped  src="./ScreenShotViewHover.css"></style>