<template>
    <aside class="hp-panel" aria-label="Planner">
        <div class="hp-panel__head">
            {{ $t('HomeV2.planner') }}
            <button type="button" class="hp-panel__close" :title="$t('HomeV2.hide_planner')" @click="$emit('close')"><ShellIcon name="x" :size="14" /></button>
        </div>
        <div class="hp-days">
            <button
                v-for="d in days"
                :key="d.key"
                type="button"
                :class="{ 'is-today': d.isToday, 'is-selected': d.key === selectedKey && !d.isToday }"
                @click="$emit('select', d.date)"
            >{{ d.label }}</button>
        </div>
        <div
            class="hp-grid ah-scroll"
            :class="{ 'is-over': over }"
            @dragover.prevent="onDragOver"
            @dragleave="over = false"
            @drop.prevent="onDrop"
        >
            <div class="hp-grid__inner" :style="{ height: `${gridHeight}px` }">
                <template v-for="h in hours" :key="h">
                    <span class="hp-grid__hour" :style="{ top: `${top(h) + 8}px` }">{{ String(h).padStart(2, '0') }}</span>
                    <span class="hp-grid__line" :style="{ top: `${top(h)}px` }"></span>
                </template>
                <div
                    v-for="item in blocks"
                    :key="item.id"
                    class="hp-block"
                    :class="`hp-block--${item.kind}`"
                    :style="{ top: `${item.top}px`, height: `${item.height}px` }"
                    :title="item.title"
                    @click="item.removable && $emit('remove-focus', item.id)"
                >{{ item.title || $t('HomeV2.focus') }}</div>
                <div class="hp-block hp-block--drop" :class="{ 'is-over': over }" :style="{ top: `${dropTop}px`, height: '40px' }">
                    {{ $t('HomeV2.planner_drop') }}
                </div>
            </div>
        </div>
        <div class="hp-panel__foot">
            {{ $t('HomeV2.planner_footer') }}
            <router-link :to="{ name: 'Planner', params: { cid: companyId } }">{{ $t('HomeV2.open_planner') }}</router-link>
        </div>
    </aside>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject, ref } from "vue";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "PlannerPanel" });

const props = defineProps({
    day: { type: Object, required: true },
    items: { type: Array, default: () => [] },
    startHour: { type: Number, default: 9 },
    endHour: { type: Number, default: 18 }
});
const emit = defineEmits(["close", "select", "schedule", "remove-focus"]);

const companyId = inject("$companyId");
const HOUR_PX = 35;
const over = ref(false);

const hours = computed(() => {
    const list = [];
    for (let h = props.startHour; h <= props.endHour - 1; h += 2) list.push(h);
    return list;
});
const gridHeight = computed(() => (props.endHour - props.startHour) * HOUR_PX + 16);
const top = (hour) => (hour - props.startHour) * HOUR_PX;

const days = computed(() => {
    const monday = moment(props.day).startOf("isoWeek");
    return Array.from({ length: 5 }, (_, i) => {
        const date = monday.clone().add(i, "days");
        return { key: date.format("YYYY-MM-DD"), label: date.format("ddd D").toUpperCase(), date, isToday: date.isSame(moment(), "day") };
    });
});
const selectedKey = computed(() => moment(props.day).format("YYYY-MM-DD"));

const blocks = computed(() => props.items.map((item) => {
    const startMin = (item.start.hours() - props.startHour) * 60 + item.start.minutes();
    const durMin = Math.max(30, item.end.diff(item.start, "minutes"));
    return { ...item, top: Math.max(0, (startMin / 60) * HOUR_PX), height: Math.max(26, (durMin / 60) * HOUR_PX - 2) };
}));

const dropTop = computed(() => {
    const occupied = blocks.value.map((b) => [b.top, b.top + b.height]);
    let candidate = moment(props.day).isSame(moment(), "day") ? Math.max(0, (moment().hours() + 1 - props.startHour) * HOUR_PX) : 0;
    for (let guard = 0; guard < 20; guard += 1) {
        const hit = occupied.find(([a, b]) => candidate < b && candidate + 40 > a);
        if (!hit) break;
        candidate = hit[1] + 4;
    }
    return Math.min(candidate, gridHeight.value - 44);
});

function onDragOver(event) {
    if (event.dataTransfer.types.includes("application/x-ah-task")) {
        over.value = true;
        event.dataTransfer.dropEffect = "move";
    }
}

function onDrop(event) {
    over.value = false;
    const taskId = event.dataTransfer.getData("application/x-ah-task");
    if (!taskId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top + event.currentTarget.scrollTop;
    const hour = Math.min(props.endHour - 1, Math.max(props.startHour, props.startHour + Math.floor(y / HOUR_PX)));
    const start = moment(props.day).startOf("day").hours(hour);
    emit("schedule", { taskId, start, end: start.clone().add(1, "hour") });
}
</script>
