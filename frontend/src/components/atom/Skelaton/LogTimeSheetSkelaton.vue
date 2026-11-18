<template>
  <div class="skeleton-ui">
    <Skelaton class="details d-flex align-items-center justify-content-between"></Skelaton>

    <div class="time-slots-div">
        <div class="time-slot">
            <div class="time-period d-flex flex-column">
                <div class="d-flex justify-content-between">
                  <Skelaton class="skeleton-text medium"></Skelaton>
                  <Skelaton class="skeleton-text small"></Skelaton>
                </div>
                <Skelaton class="skeleton-text long"></Skelaton>
            </div>
            <div class="screenshots-div d-flex flex-wrap">
              <Skelaton class="screenshot" v-for="index in 7" :key="index"></Skelaton>
            </div>
        </div>
    </div>
  </div>
</template>

<script setup>
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue";
</script>

<style scoped>
.skeleton-ui {
  color: var(--ink);
  padding: 20px;
  margin-bottom: 20px;
}

.skeleton-text {
  height: 12px;
  margin: 5px 0;
}


.skeleton-text.small {
  width: 120px;
  height: 22px;
}

.skeleton-text.medium {
  width: 200px;
  height: 22px;
}

.skeleton-text.long {
  width: 50%;
  height: 22px;
}

.details {
  background-color: var(--fill);
  padding: 10px 20px;
  border-radius:  8px 8px 0 0;
  box-shadow: 0 2px 4px var(--shadow-ink);
  height: 60px;
  margin-bottom: 0;
}
.time-slots-div {
  border: 1px solid var(--border);
  border-top: 0;
  padding-top: 10px;
  background-color: var(--surface);
  border-bottom-left-radius: 2px;
  border-bottom-right-radius: 2px;
  margin-top: -10px;
  margin-bottom: 10px;
  padding-bottom: 20px;
  padding: 10px 0 20px 0;
}

.time-slots-div .time-slot {
  margin-bottom: 20px;
}
.time-period {
  margin: 10px;
}
.screenshots-div {
    gap: 20px;
    margin: 22px 20px 0;
}
.screenshot {
  padding: 10px;
  width: 100%;
  max-width: 21.101%;
  flex: 0 0 21.101%;
  border-radius: 12px;
  box-sizing: border-box;
  height: 100px;
}
</style>
