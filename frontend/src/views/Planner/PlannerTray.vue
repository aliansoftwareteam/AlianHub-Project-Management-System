<template>
    <div class="planner__tray">
        <div class="planner__tray-title">
            {{ title }}
            <span v-if="!tabs.length" class="ah-mono planner__tray-count">{{ items.length }}</span>
        </div>
        <div v-if="tabs.length" class="planner__tray-tabs">
            <button
                v-for="tab in tabs"
                :key="tab.key"
                type="button"
                class="hc-tab"
                :class="{ 'is-active': active === tab.key }"
                @click="$emit('tab', tab.key)"
            >{{ tab.label }} · {{ tab.count }}</button>
        </div>
        <div class="planner__tray-list">
            <article
                v-for="item in items"
                :key="item.id"
                class="planner__card"
                :class="{ 'planner__card--overdue': item.danger, 'planner__card--picked': selectedId === item.id }"
                draggable="true"
                @dragstart="$emit('dragstart', $event, item.task)"
                @dragend="$emit('dragend')"
                @click="$emit('select', item.task)"
            >
                <span>{{ item.title }}</span>
                <span class="planner__card-meta" :class="{ 'planner__card-meta--danger': item.danger }">{{ item.meta }}</span>
            </article>
            <p v-if="!items.length && !loading" class="hc-hint planner__tray-empty">{{ emptyText }}</p>
            <p v-if="loading" class="hc-loading">{{ loadingText }}</p>
        </div>
        <div v-if="footer" class="planner__tray-foot">{{ footer }}</div>
    </div>
</template>

<script setup>
defineOptions({ name: "PlannerTray" });

defineProps({
    title: { type: String, default: "" },
    tabs: { type: Array, default: () => [] },
    active: { type: String, default: "" },
    items: { type: Array, default: () => [] },
    selectedId: { type: String, default: "" },
    loading: { type: Boolean, default: false },
    loadingText: { type: String, default: "" },
    emptyText: { type: String, default: "" },
    footer: { type: String, default: "" }
});

defineEmits(["tab", "select", "dragstart", "dragend"]);
</script>
