<template>
    <nav ref="root" class="ai-mnav" data-test="ai-mnav" :aria-label="$t('Ai.title')">
        <div class="ai-mnav__scroll">
            <router-link
                v-for="item in primary"
                :key="item.name"
                class="ai-mnav__item"
                data-test="ai-mnav-item"
                :to="{ name: item.name, params: { cid: companyId } }"
            >
                <ShellIcon :name="item.icon" :size="15" />
                <span data-test="ai-mnav-label">{{ $t(item.label) }}</span>
                <span v-if="item.count" class="ai-mnav__count ah-mono" data-test="ai-mnav-count">{{ item.count }}</span>
            </router-link>
        </div>
        <div v-if="extra.length" class="ai-mnav__more-wrap">
            <button
                ref="moreButton"
                type="button"
                class="ai-mnav__more"
                data-test="ai-mnav-more"
                :aria-label="$t('Ai.more')"
                :title="$t('Ai.more')"
                :aria-expanded="moreOpen ? 'true' : 'false'"
                @click="moreOpen = !moreOpen"
            >
                <ShellIcon name="more" :size="18" />
            </button>
            <div v-if="moreOpen" class="ah-pop ai-mnav__menu" data-test="ai-mnav-menu" @keydown.esc.stop="closeMore(true)">
                <router-link
                    v-for="item in extra"
                    :key="item.name"
                    class="ah-pop__item"
                    data-test="ai-mnav-extra"
                    :to="{ name: item.name, params: { cid: companyId } }"
                    @click="closeMore(false)"
                >
                    <ShellIcon :name="item.icon" :size="15" /><span>{{ $t(item.label) }}</span>
                </router-link>
            </div>
        </div>
    </nav>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "AiMobileNav" });

/* AiSidebar hands over its own everyday and Setup lists, so the phone bar never drifts from the sidebar. */
const props = defineProps({
    primary: { type: Array, default: () => [] },
    extra: { type: Array, default: () => [] }
});

const router = useRouter();
const route = useRoute();
const companyId = inject("$companyId");

const root = ref(null);
const moreButton = ref(null);
const moreOpen = ref(false);

const available = (items) => items.filter((item) => typeof router?.hasRoute !== "function" || router.hasRoute(item.name));

const primary = computed(() => available(props.primary));
const extra = computed(() => available(props.extra));

const closeMore = (refocus) => {
    moreOpen.value = false;
    if (refocus) moreButton.value?.focus();
};

const onDocumentClick = (event) => {
    if (moreOpen.value && root.value && !root.value.contains(event.target)) closeMore(false);
};

watch(() => route?.name, () => closeMore(false));
onMounted(() => document.addEventListener("click", onDocumentClick));
onUnmounted(() => document.removeEventListener("click", onDocumentClick));
</script>

<style>
.ai-mnav { display: none; }

@media (max-width: 767px) {
    .ai-mnav {
        display: flex; align-items: center; gap: 4px; flex: none; position: relative; z-index: 5;
        padding: 4px 8px; border-bottom: 1px solid var(--hairline); background: var(--surface);
    }
    .ai-mnav__scroll { display: flex; gap: 2px; flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; }
    .ai-mnav__scroll::-webkit-scrollbar { display: none; }
    .ai-mnav__item {
        display: inline-flex; align-items: center; gap: 6px; flex: none; min-height: 44px; padding: 0 10px;
        border-radius: 8px; white-space: nowrap; text-decoration: none;
        font: 500 13px/1 var(--font-ui); color: var(--ink);
    }
    .ai-mnav__item:hover { background: var(--surface-hover); color: var(--ink); text-decoration: none; }
    .ai-mnav__item:focus-visible, .ai-mnav__more:focus-visible { outline: none; box-shadow: var(--focus); }
    .ai-mnav__item.router-link-active { background: var(--brand-tint); color: var(--brand); }
    .ai-mnav__count {
        min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
        background: var(--brand); color: var(--on-brand); font-size: 10.5px; line-height: 18px; text-align: center;
    }
    .ai-mnav__more-wrap { position: relative; flex: none; }
    .ai-mnav__more {
        width: 44px; height: 44px; display: grid; place-items: center;
        border: 0; border-radius: 8px; background: transparent; color: var(--ink-2); cursor: pointer;
    }
    .ai-mnav__more[aria-expanded="true"], .ai-mnav__more:hover { background: var(--surface-hover); color: var(--ink); }
    .ai-mnav__menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; max-height: 60vh; overflow-y: auto; }
    .ai-mnav__menu .ah-pop__item { min-height: 44px; }
}
</style>
