<template>
    <div class="reaction-bar d-flex align-items-center">
        <span
            v-for="group in groupedReactions"
            :key="'reaction-'+group.emoji"
            class="reaction-bar__chip font-size-12 cursor-pointer"
            :class="{'reaction-bar__chip--mine': group.mine}"
            :title="group.names"
            @click="$emit('toggle', group.emoji)"
        >
            {{ group.emoji }} <span class="reaction-bar__count">{{ group.count }}</span>
        </span>
        <span
            class="reaction-bar__add cursor-pointer"
            :class="{'reaction-bar__add--compact': compact}"
            :title="$t('Projects.add_reaction')"
            @click.stop="openPicker"
        >☺<sup>+</sup></span>
        <!-- The picker teleports to <body> with viewport-clamped fixed
             coordinates so overflow containers and sidebars can never
             clip or overlap it (right-aligned comments sit at the edge). -->
        <Teleport to="body">
            <span v-if="pickerOpen" class="reaction-bar__overlay" @click.stop="pickerOpen = false"></span>
            <span v-if="pickerOpen" class="reaction-bar__picker" :style="pickerStyle">
                <span
                    v-for="emoji in REACTION_EMOJIS"
                    :key="'pick-'+emoji"
                    class="reaction-bar__picker-emoji cursor-pointer"
                    @click.stop="pick(emoji)"
                >{{ emoji }}</span>
            </span>
        </Teleport>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, inject, ref } from "vue";

// UTILS
import { useGetterFunctions } from "@/composable";

const { getUser } = useGetterFunctions();
const userId = inject('$userId');

// Must match the backend allowlist in Modules/Reactions/helpers/reactionRules.js
const REACTION_EMOJIS = ['👍', '❤️', '😄', '🎉', '😮', '😢', '🚀', '👀'];

const PICKER_WIDTH = 248;
const PICKER_HEIGHT = 40;

const props = defineProps({
    reactions: {
        type: Array,
        default: () => []
    },
    compact: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['toggle']);

const pickerOpen = ref(false);
const pickerStyle = ref({});

const groupedReactions = computed(() => {
    const groups = new Map();
    (props.reactions || []).forEach((reaction) => {
        if (!groups.has(reaction.emoji)) {
            groups.set(reaction.emoji, { emoji: reaction.emoji, count: 0, mine: false, userIds: [] });
        }
        const group = groups.get(reaction.emoji);
        group.count++;
        group.userIds.push(reaction.userId);
        if (String(reaction.userId) === String(userId.value)) {
            group.mine = true;
        }
    });
    return Array.from(groups.values()).map((group) => ({
        ...group,
        names: group.userIds.map((id) => getUser(id).Employee_Name).join(', '),
    }));
});

function openPicker(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    // Clamp horizontally inside the viewport; prefer opening above the
    // trigger, fall back to below when there's no room.
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - PICKER_WIDTH - 8);
    let top = rect.top - PICKER_HEIGHT - 6;
    if (top < 8) {
        top = rect.bottom + 6;
    }
    pickerStyle.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` };
    pickerOpen.value = !pickerOpen.value;
}

function pick(emoji) {
    pickerOpen.value = false;
    emit('toggle', emoji);
}
</script>

<style scoped>
.reaction-bar {
    flex-wrap: wrap;
    gap: 4px;
}
.reaction-bar__chip {
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 1px 8px;
    background: #fff;
    line-height: 18px;
    white-space: nowrap;
}
.reaction-bar__chip--mine {
    border-color: #7b68ee;
    background: #f3f0ff;
}
.reaction-bar__count {
    color: #6a6a6a;
}
.reaction-bar__add {
    color: #9a9a9a;
    font-size: 15px;
    padding: 0 4px;
}
.reaction-bar__add:hover {
    color: #555;
}
.reaction-bar__add--compact {
    font-size: 13px;
}
</style>

<style>
/* Teleported to <body> — must NOT be scoped. */
.reaction-bar__overlay {
    position: fixed;
    inset: 0;
    z-index: 9998;
}
.reaction-bar__picker {
    position: fixed;
    z-index: 9999;
    display: flex;
    gap: 4px;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 16px;
    padding: 5px 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.12);
}
.reaction-bar__picker-emoji {
    font-size: 16px;
    padding: 1px 2px;
    border-radius: 4px;
    cursor: pointer;
}
.reaction-bar__picker-emoji:hover {
    background: #f0f0f0;
}
</style>
