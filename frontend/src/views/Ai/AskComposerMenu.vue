<template>
    <div class="ask-menu" data-test="ask-menu">
        <span class="ah-label ask-menu__head">{{ kind === 'skill' ? $t('Ask.menu_skills') : $t('Ask.menu_context') }}</span>
        <ul :id="id" class="ask-menu__list" role="listbox" :aria-label="kind === 'skill' ? $t('Ask.menu_skills') : $t('Ask.menu_context')">
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
                <span v-if="kind === 'mention'" class="ah-chip ah-chip--sm">{{ $t(KIND_LABELS[item.kind]) }}</span>
                <span class="ask-menu__title">{{ item.title }}</span>
                <span v-if="item.sub" class="ask-menu__sub">{{ item.sub }}</span>
            </li>
        </ul>
        <p v-if="!items.length" class="ask-menu__empty">{{ emptyText }}</p>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";

defineOptions({ name: "AskComposerMenu" });

const props = defineProps({
    id: { type: String, required: true },
    kind: { type: String, required: true },
    items: { type: Array, default: () => [] },
    active: { type: Number, default: 0 },
    searching: { type: Boolean, default: false },
    short: { type: Boolean, default: false }
});
defineEmits(["pick", "hover"]);

const KIND_LABELS = Object.freeze({ task: "Ask.kind_task", page: "Ask.kind_page", project: "Ask.kind_project" });

const { t } = useI18n();

const emptyText = computed(() => {
    if (props.kind === "skill") return t("AiLanding.skills_none");
    if (props.short) return t("Ask.menu_context_hint");
    return props.searching ? t("Ask.menu_searching") : t("Ask.menu_context_none");
});
</script>

<style>
.ask-menu { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; padding: 8px; border: 1px solid var(--hairline); border-radius: var(--r-input); background: var(--surface); box-shadow: var(--shadow-pop); max-height: 280px; overflow-y: auto; }
.ask-menu__head { padding: 0 4px; }
.ask-menu__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ask-menu__item { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 8px; border-radius: var(--r-input); color: var(--ink); cursor: pointer; }
.ask-menu__item.is-active { background: var(--brand-tint); }
.ask-menu__title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ask-menu__sub { flex: 1; min-width: 0; color: var(--ink-2); font: var(--text-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ask-menu__empty { margin: 0; padding: 4px; color: var(--ink-2); font: var(--text-small); }
</style>
