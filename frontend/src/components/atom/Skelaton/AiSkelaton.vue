<template>
    <div class="d-flex align-items-center">
        <div class="round-skeleton"></div>
        <div class="skelaton-loader skleton-line" :style="[{width : generateRandomNumber()}]"></div>
    </div>
</template>

<script setup>
import { defineComponent } from "vue";

defineComponent({
    name: "skelaton-loader"
})

function generateRandomNumber(min = 900, max = 1200) {
    return Math.floor(Math.random() * (max - min + 1)) + min + 'px';
}
</script>

<style lang="css" scoped>
.skelaton-loader {
    animation: pulse-bg 1s infinite;
}
.round-skeleton{
    width: 15px;
    height: 15px;
    background: var(--track);
    border: 1px solid transparent;
    border-radius: 7.5px;
}
.skleton-line{
    height: 15px;
    border-radius: 2px;
    margin-left: 15px;
}

@keyframes pulse-bg {
    0% {
      background-color: var(--track);
    }
    50% {
      background-color: var(--border);
    }
    100% {
      background-color: var(--track);
    }
}
</style>