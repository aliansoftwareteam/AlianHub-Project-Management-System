<template>
    <!--
        Subtask completion badge (AHE-3776).
        Shows how far a parent task has progressed based on its subtasks.
        Renders nothing unless there is at least one subtask, so tasks without
        subtasks are completely unaffected.

        variant "pill" — compact ring + percent, for the task-detail header.
        variant "bar"  — mini progress bar + percent + "done/total", for the
                         subtask section header.

        Purely presentational: it owns no data and makes no requests; the caller
        passes `completed` and `total` and this component only formats them.
    -->
    <span
        v-if="hasSubtasks"
        class="subtask-progress"
        :class="[`subtask-progress--${variant}`, `subtask-progress--${state}`]"
        :title="tooltip"
        role="img"
        :aria-label="tooltip"
    >
        <!-- compact ring (pill variant) -->
        <svg
            v-if="variant === 'pill'"
            class="subtask-progress__ring"
            width="14"
            height="14"
            viewBox="0 0 18 18"
            aria-hidden="true"
        >
            <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
            <circle
                v-if="percent > 0"
                cx="9"
                cy="9"
                r="7"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                :stroke-dasharray="`${dash} ${circumference}`"
                transform="rotate(-90 9 9)"
            />
        </svg>

        <!-- mini bar (bar variant) -->
        <span v-else class="subtask-progress__track" aria-hidden="true">
            <span class="subtask-progress__fill" :style="{ width: percent + '%' }"></span>
        </span>

        <span class="subtask-progress__percent">{{ percent }}%</span>
        <span v-if="variant === 'bar'" class="subtask-progress__count">{{ safeCompleted }}/{{ total }}</span>
    </span>
</template>

<script setup>
import { computed, defineProps } from 'vue';

const props = defineProps({
    // Number of completed subtasks (statusType === 'close').
    completed: {
        type: Number,
        default: 0
    },
    // Total number of (non-deleted) subtasks.
    total: {
        type: Number,
        default: 0
    },
    // 'pill' (header) or 'bar' (subtask section header).
    variant: {
        type: String,
        default: 'pill'
    }
});

const hasSubtasks = computed(() => Number(props.total) > 0);

// Clamp completed into [0, total] so a stale/partial count can never produce a
// nonsensical percentage like 120%.
const safeCompleted = computed(() => {
    const total = Number(props.total) || 0;
    const completed = Number(props.completed) || 0;
    return Math.max(0, Math.min(completed, total));
});

const percent = computed(() => {
    const total = Number(props.total) || 0;
    if (total <= 0) return 0;
    return Math.round((safeCompleted.value / total) * 100);
});

// 0% = not started (gray), 100% = done (green), anything between = in progress (blue).
const state = computed(() => {
    if (percent.value >= 100) return 'done';
    if (percent.value <= 0) return 'empty';
    return 'progress';
});

// SVG ring geometry: r = 7 → circumference ≈ 43.98, rounded to 44.
const circumference = 44;
const dash = computed(() => Math.round((percent.value / 100) * circumference));

const tooltip = computed(() => `${safeCompleted.value} of ${props.total} subtasks complete (${percent.value}%)`);
</script>

<style scoped>
.subtask-progress {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 999px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    vertical-align: middle;
}

/* Compact pill for the task-detail header (option A). */
.subtask-progress--pill {
    padding: 3px 9px 3px 7px;
    font-size: 12px;
}
.subtask-progress--pill .subtask-progress__ring {
    flex: 0 0 auto;
}

/* Mini bar for the subtask section header (option C). */
.subtask-progress--bar {
    padding: 3px 10px;
    font-size: 12px;
    background: #f1f2f4;
    border: 1px solid #e0e2e6;
    color: #5e6c84;
    gap: 7px;
}
.subtask-progress__track {
    display: inline-block;
    width: 60px;
    height: 6px;
    border-radius: 999px;
    background: #dfe1e6;
    overflow: hidden;
    position: relative;
    flex: 0 0 auto;
}
.subtask-progress__fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-radius: 999px;
    transition: width 0.25s ease;
}
.subtask-progress__count {
    color: #5e6c84;
}

/* Colour states. */
.subtask-progress--empty {
    color: #8993a4;
}
.subtask-progress--empty.subtask-progress--pill {
    background: #f1f2f4;
}
.subtask-progress--progress.subtask-progress--pill {
    background: #e6f0fb;
    color: #185fa5;
}
.subtask-progress--done.subtask-progress--pill {
    background: #e1f5ee;
    color: #0f6e56;
}

.subtask-progress--empty .subtask-progress__fill {
    background: #b4b2a9;
}
.subtask-progress--progress .subtask-progress__fill {
    background: #378add;
}
.subtask-progress--done .subtask-progress__fill {
    background: #1d9e75;
}
.subtask-progress--progress .subtask-progress__percent {
    color: #185fa5;
}
.subtask-progress--done .subtask-progress__percent {
    color: #0f6e56;
}
</style>
