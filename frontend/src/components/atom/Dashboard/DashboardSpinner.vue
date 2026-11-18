<template>
    <div v-if="isSpinner" class="d-flex align-items-center justify-content-center lds-roller h-100dvh dashboard-spinner">
        <img :src="logo" alt="logo" class="position-ab z-index-1 company__logo">
        <div class="dashboard-spinner-ring"></div>
    </div>
</template>

<script setup>
import { defineProps } from "vue";
defineProps({
    isSpinner: {
        type: Boolean,
        default: false
    },
})
const logo = "/api/v1/getlogo?key=logo&type=desktop";

</script>

<style scoped>

/* From Uiverse.io by Vazafirst */ 
.dashboard-spinner-ring {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 160px;
    height: 160px;
    position: relative;
}
.dashboard-spinner-ring::before {
    content: "";
    box-sizing: border-box;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    border: 5px solid var(--brand-tint);
    border-top-color: var(--brand);
    animation: spinner 1s ease-in-out infinite;
}
.dashboard-spinner {
    position: fixed;
    height: 100vh;
    width: 100vw;
    z-index: 1;
    top: 0;
    left: 0;
}

</style>