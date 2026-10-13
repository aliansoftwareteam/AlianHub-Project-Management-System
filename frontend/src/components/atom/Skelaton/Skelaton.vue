<template>
    <div class="skelaton-loader"></div>
</template>

<script setup>
import { defineComponent } from "vue";

defineComponent({
    name: "skelaton-loader"
})
</script>

<style lang="css" scoped>
@keyframes loading {
  to {
    background-position-x: -20%;
  }
}
.skelaton-loader {
  background: linear-gradient(
    100deg,
    var(--fill) 0%,
    var(--border) 50%,
    var(--fill) 100%
  ) transparent;
  background-size: 200% 100%;
  background-position-x: 180%;
  animation: 1s loading ease-in-out infinite;
}
</style>
