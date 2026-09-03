<template>
    <GoogleAuth v-if="provider === 'google'" :mode="mode" :companyID="companyID" :companyUserDocID="companyUserDocID" />
    <GithubAuth v-else-if="provider === 'github'" :mode="mode" :companyID="companyID" :companyUserDocID="companyUserDocID" />
    <GitlabAuth v-else-if="provider === 'gitlab'" :mode="mode" :companyID="companyID" :companyUserDocID="companyUserDocID" />
</template>

<script setup>
import { defineProps } from "vue";
import GoogleAuth from "./google/GoogleAuth.vue";
import GithubAuth from "./github/GithubAuth.vue";
import GitlabAuth from "./gitlab/GitlabAuth.vue";

defineProps({
    provider: { type: String, required: true },
    mode: { type: String, default: "login" },
    companyID: { type: String, default: null },
    companyUserDocID: { type: String, default: null }
});
</script>
