<template>
    <div ref="tooltipTrigger" class="tooltip-trigger" @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave"
        @click="handleClick">
        <slot>
            <span v-if="props.label && !props.isImage" class="text-ellipsis label_ellipsis">
                {{ props.label }}
            </span>
            <!-- Show img only if label doesn't exist AND isImage is true -->
            <img v-if="!props.label && props.isImage" class="error_message_image" :src="props.Image || defaultErrorImage" alt="error" />
        </slot>
    </div>

    <teleport to="body">
        <transition name="tooltip-fade">
            <div v-if="isVisible" ref="tooltipRef" class="tooltip-container" :class="arrowClass" :style="tooltipStyles"
                @mouseenter="handleTooltipEnter" @mouseleave="handleTooltipLeave" @click.stop>
                <div class="tooltip-arrow" :style="arrowStyles"></div>

                <div class="tooltip-content">
                    <div ref="contentRef" class="tooltip-text"
                        :class="{ 'is-truncated': showReadMore && !isExpanded && shouldTruncate }"
                        :style="truncateStyles">
                        <span v-html="sanitizeInline(text)" class="tooltip-desc"></span>
                    </div>
                    <button v-if="showReadMore && shouldTruncate && !isExpanded" class="read-more-btn"
                        @click.stop.prevent="toggleExpand">
                        Read more
                    </button>
                </div>
            </div>
        </transition>
    </teleport>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick, inject } from 'vue';
import { sanitizeInline } from '@/utils/sanitizeHtml';

const props = defineProps({
    text: {
        type: String,
        required: true
    },
    label: {
        type: String,
        default: ''
    },
    Image: {
        type: String,
        default: ''
    },
    isImage: {
        type: Boolean,
        default: false
    },
    width: {
        type: String,
        default: 'fit-content'
    },
    height: {
        type: String,
        default: 'auto'
    },
    maxLines: {
        type: Number,
        default: 3
    },
    offset: {
        type: Number,
        default: 8
    },
    showReadMore: {
        type: Boolean,
        default: false
    },
    hideDelay: {
        type: Number,
        default: 100
    }
});

const defaultErrorImage = require("@/assets/images/svg/error_message.svg");

const clientWidth = inject("$clientWidth");

const isVisible = ref(false);
const isExpanded = ref(false);
const tooltipTrigger = ref(null);
const tooltipRef = ref(null);
const contentRef = ref(null);
const position = ref({ top: 0, left: 0 });
const arrowPosition = ref({ left: 0 });
const isTooltipBelow = ref(false);
const shouldTruncate = ref(false);
const activeTooltipId = ref(null);
const hideTimer = ref(null);

const tooltipId = `tooltip-${Math.random().toString(36).substr(2, 9)}`;

const calculatePosition = async () => {
    if (!tooltipTrigger.value || !tooltipRef.value) return;

    await nextTick();

    const triggerRect = tooltipTrigger.value.getBoundingClientRect();
    const tooltipRect = tooltipRef.value.getBoundingClientRect();
    
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let top = triggerRect.top - tooltipRect.height - props.offset;
    let left = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);

    isTooltipBelow.value = false;

    if (top < 0) {
        top = triggerRect.bottom + props.offset;
        isTooltipBelow.value = true;
    }

    if (left + tooltipRect.width > viewportWidth) {
        left = viewportWidth - tooltipRect.width - 10;
    }

    if (left < 0) {
        left = 10;
    }

    if (triggerRect.bottom + tooltipRect.height + props.offset > viewportHeight) {
        top = triggerRect.top - tooltipRect.height - props.offset;
        isTooltipBelow.value = false;
    }

    const triggerCenterX = triggerRect.left + (triggerRect.width / 2);
    const arrowLeft = triggerCenterX - left;

    position.value = { top, left };
    arrowPosition.value = { left: arrowLeft };
};

const checkTruncation = async () => {
    if (!contentRef.value || !props.showReadMore) {
        shouldTruncate.value = false;
        return;
    }

    await nextTick();

    const lineHeight = parseFloat(getComputedStyle(contentRef.value).lineHeight);
    const maxHeight = lineHeight * props.maxLines;
    const actualHeight = contentRef.value.scrollHeight;

    shouldTruncate.value = actualHeight > maxHeight;
};

const clearHideTimer = () => {
    if (hideTimer.value) {
        clearTimeout(hideTimer.value);
        hideTimer.value = null;
    }
};

const handleMouseEnter = () => {
    if (clientWidth.value > 767) {
        clearHideTimer();
        closeOtherTooltips();
        showTooltip();
    }
};

const handleMouseLeave = () => {
    if (clientWidth.value > 767) {
        scheduleHide();
    }
};

const handleTooltipEnter = () => {
    if (clientWidth.value > 767) {
        clearHideTimer();
    }
};

const handleTooltipLeave = () => {
    if (clientWidth.value > 767) {
        scheduleHide();
    }
};

const scheduleHide = () => {
    clearHideTimer();
    hideTimer.value = setTimeout(() => {
        hideTooltip();
    }, props.hideDelay);
};

const handleClick = (e) => {
    if (clientWidth.value <= 767) {
        e.stopPropagation();
        e.preventDefault();

        if (isVisible.value && activeTooltipId.value === tooltipId) {
            hideTooltip();
        } else {
            closeOtherTooltips();
            showTooltip();
        }
    }
};

const showTooltip = async () => {
    clearHideTimer();
    isVisible.value = true;
    activeTooltipId.value = tooltipId;

    await nextTick();

    if (props.showReadMore) {
        await checkTruncation();
    }

    await calculatePosition();
};

const hideTooltip = () => {
    clearHideTimer();
    isVisible.value = false;
    isExpanded.value = false;

    if (activeTooltipId.value === tooltipId) {
        activeTooltipId.value = null;
    }
};

const closeOtherTooltips = () => {
    window.dispatchEvent(new CustomEvent('close-tooltips', { detail: { id: tooltipId } }));
};

const toggleExpand = async (e) => {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }

    isExpanded.value = !isExpanded.value;
    await nextTick();
    await calculatePosition();
};

const handleResize = () => {
    hideTooltip();
};

const handleScroll = () => {
    if (isVisible.value && clientWidth.value > 767) {
        calculatePosition();
    }
};

const handleClickOutside = (e) => {
    if (clientWidth.value <= 767 && isVisible.value) {
        if (tooltipRef.value && !tooltipRef.value.contains(e.target) &&
            tooltipTrigger.value && !tooltipTrigger.value.contains(e.target)) {
            hideTooltip();
        }
    }
};

const handleCloseTooltips = (e) => {
    if (e.detail.id !== tooltipId && isVisible.value) {
        hideTooltip();
    }
};

const tooltipStyles = computed(() => ({
    top: `${position.value.top}px`,
    left: `${position.value.left}px`,
    width: props.width,
    height: isExpanded.value ? 'auto' : props.height,
    maxWidth: clientWidth.value <= 767 ? '90vw' : '400px'
}));

const arrowStyles = computed(() => ({
    left: `${arrowPosition.value.left}px`
}));

const arrowClass = computed(() => ({
    'tooltip-below': isTooltipBelow.value,
    'tooltip-above': !isTooltipBelow.value
}));

const truncateStyles = computed(() => {
    if (props.showReadMore && !isExpanded.value && shouldTruncate.value) {
        return {
            display: '-webkit-box',
            WebkitLineClamp: props.maxLines,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
        };
    }
    return {};
});

watch(isVisible, async (newVal) => {
    if (newVal) {
        await nextTick();
        await calculatePosition();
    }
});

onMounted(() => {
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
    }, 100);

    window.addEventListener('close-tooltips', handleCloseTooltips);
});

onUnmounted(() => {
    clearHideTimer();
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('scroll', handleScroll, true);
    document.removeEventListener('click', handleClickOutside);
    window.removeEventListener('close-tooltips', handleCloseTooltips);
});
</script>

<style scoped>
    @import '@/components/molecules/ToolTip/style.css';
</style>