<template>
    <div class="ask-menu" data-test="ask-menu">
        <span class="ah-label ask-menu__head">{{ kind === 'skill' ? $t('Ask.menu_skills') : $t('Ask.menu_context') }}</span>
        <ul v-if="kind === 'skill'" :id="id" class="ask-menu__list" role="listbox" :aria-label="$t('Ask.menu_skills')">
            <li
                v-for="(item, index) in items"
                :id="`${id}-${index}`"
                :key="`${item.kind}-${item.id}`"
                class="ask-menu__item"
                :class="{ 'is-active': index === active }"
                role="option"
                :aria-selected="index === active ? 'true' : 'false'"
                :data-kind="item.kind"
                data-test="ask-menu-item"
                @mousedown.prevent
                @mousemove="$emit('hover', index)"
                @click="$emit('pick', item)"
            >
                <span class="ask-menu__title">{{ item.title }}</span>
                <span v-if="item.sub" class="ask-menu__sub">{{ item.sub }}</span>
            </li>
        </ul>
        <div v-else :id="id" class="ask-menu__list" role="listbox" :aria-label="$t('Ask.menu_context')">
            <ul v-for="group in groups" :key="group.kind" class="ask-menu__group" role="group" :aria-labelledby="`${id}-${group.kind}`" data-test="ask-menu-group">
                <li :id="`${id}-${group.kind}`" class="ask-menu__group-head" role="presentation">{{ $t(KINDS[group.kind].group) }}</li>
                <li
                    v-for="{ item, index } in group.items"
                    :id="`${id}-${index}`"
                    :key="`${item.kind}-${item.id}`"
                    class="ask-menu__item"
                    :class="{ 'is-active': index === active }"
                    role="option"
                    :aria-selected="index === active ? 'true' : 'false'"
                    :data-kind="item.kind"
                    data-test="ask-menu-item"
                    @mousedown.prevent
                    @mousemove="$emit('hover', index)"
                    @click="$emit('pick', item)"
                >
                    <ShellIcon :name="KINDS[item.kind].icon" :size="13" class="ask-menu__icon" />
                    <span class="ask-menu__title">{{ item.title }}</span>
                    <span v-if="item.sub" class="ask-menu__sub">{{ item.sub }}</span>
                </li>
            </ul>
        </div>
        <p v-if="!items.length" class="ask-menu__empty">{{ emptyText }}</p>
        <p v-else-if="kind === 'mention'" class="ask-menu__keys">{{ $t('Ask.menu_keys') }}</p>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { MENTION_KIND_LOOK } from "./askMentionLook";

defineOptions({ name: "AskComposerMenu" });

const props = defineProps({
    id: { type: String, required: true },
    kind: { type: String, required: true },
    items: { type: Array, default: () => [] },
    groups: { type: Array, default: () => [] },
    active: { type: Number, default: 0 },
    searching: { type: Boolean, default: false }
});
defineEmits(["pick", "hover"]);

const KINDS = MENTION_KIND_LOOK;

const { t } = useI18n();

const emptyText = computed(() => {
    if (props.kind === "skill") return t("AiLanding.skills_none");
    return props.searching ? t("Ask.menu_searching") : t("Ask.menu_context_none");
});
</script>

<style>
.ask-menu { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; padding: 8px; border: 1px solid var(--hairline); border-radius: var(--r-input); background: var(--surface); box-shadow: var(--shadow-pop); max-height: 320px; overflow-y: auto; }
.ask-menu__head { padding: 0 4px; }
.ask-menu__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ask-menu__group { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ask-menu__group + .ask-menu__group { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--hairline); }
.ask-menu__group-head { padding: 2px 8px; color: var(--ink-2); font: var(--text-small); font-weight: 600; }
.ask-menu__item { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 8px; border-radius: var(--r-input); color: var(--ink); cursor: pointer; }
.ask-menu__item.is-active { background: var(--brand-tint); }
.ask-menu__icon { flex: none; color: var(--ink-2); }
.ask-menu__title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ask-menu__sub { flex: 1; min-width: 0; color: var(--ink-2); font: var(--text-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-menu__empty { margin: 0; padding: 4px; color: var(--ink-2); font: var(--text-small); }
.ask-menu__keys { margin: 0; padding: 4px 4px 0; color: var(--ink-2); font: var(--text-small); }
</style>
