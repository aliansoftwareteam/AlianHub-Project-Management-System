<template>
    <div class="d-flex justify-content-center outh-item-gap">
        <div v-if="isAuthWithGoogle && isAuthWithGoogle === 'true'">
            <oAuthWithGoogle :mode="mode" :companyID="companyID" :companyUserDocID="companyUserDocID"/>
        </div>
        <div v-if="isAuthWithGithub && isAuthWithGithub === 'true'">
            <oAuthWithGithub :mode="mode" :companyID="companyID" :companyUserDocID="companyUserDocID"/>
        </div>
        <div v-if="isAuthWithGitlab && isAuthWithGitlab === 'true'">
            <oAuthWithGitlab :mode="mode" :companyID="companyID" :companyUserDocID="companyUserDocID"/>
        </div>
    </div>
</template>

<script setup>
import { ref, defineProps } from "vue";

defineProps({
    mode: {
        type: String,
        default: "login"
    },
    companyID: {
        type: String,
        default: null
    },
    companyUserDocID: {
        type: String,
        default: null
    }
});

const isAuthWithGoogle = ref(process.env.VUE_APP_IS_GOOGLE_LOGIN || null);
const isAuthWithGithub = ref(process.env.VUE_APP_IS_GITHUB_LOGIN || null);
const isAuthWithGitlab = ref(process.env.VUE_APP_IS_GITLAB_LOGIN || null);
</script>

<style>
.outh-item-gap {
    gap: 20px;
}

.oauth-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid #ccc;
    border-top: 2px solid #333;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
}

@keyframes spin {
    0% {
        transform: rotate(0deg);
    }
    100% {
        transform: rotate(360deg);
    }
}
</style>