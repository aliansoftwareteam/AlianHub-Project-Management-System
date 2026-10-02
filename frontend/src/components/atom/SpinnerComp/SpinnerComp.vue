<template>
    <div v-if="isSpinner">
        <div class="spinner-comp-ring"></div>
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

</script>

<style scoped>

.spinner-comp-ring {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    animation: spin 2s linear infinite;
    z-index: 1;
}

.spinner-comp-ring::before {
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

@keyframes spin {
    0% {
        transform: translate(-50%, -50%) rotate(0deg);
    }
    100% {
        transform: translate(-50%, -50%) rotate(360deg);
    }
}
</style>