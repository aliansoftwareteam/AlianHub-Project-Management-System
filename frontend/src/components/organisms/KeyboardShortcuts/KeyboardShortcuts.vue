<template>
    <teleport to="body">
        <div v-if="shortcutSheet.open" class="ksh-layer">
            <div class="ksh-backdrop" aria-hidden="true" @click="closeShortcutSheet()"></div>
            <div
                ref="dialogEl"
                class="ksh"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="headingId"
                tabindex="-1"
                data-test="shortcut-sheet"
                @keydown.esc.stop.prevent="closeShortcutSheet()"
            >
                <div class="ksh__head">
                    <h2 :id="headingId" class="ah-h2">{{ $t('Shortcuts.title') }}</h2>
                    <button type="button" class="ksh__close" :aria-label="$t('Shortcuts.close')" @click="closeShortcutSheet()">
                        <ShellIcon name="x" :size="16" />
                    </button>
                </div>
                <p v-if="!shortcutPrefs.singleKeys" class="ksh__note">{{ $t('Shortcuts.single_keys_off') }}</p>
                <div class="ksh__groups">
                    <section v-for="group in groups" :key="group.id" class="ksh__group" :aria-labelledby="`${headingId}-${group.id}`">
                        <h3 :id="`${headingId}-${group.id}`" class="ah-h3 ksh__group-title">{{ $t(`Shortcuts.group_${group.id}`) }}</h3>
                        <dl class="ksh__list">
                            <div v-for="entry in group.entries" :key="entry.id" class="ksh__row">
                                <dt class="ksh__label">{{ $t(entry.label) }}</dt>
                                <dd class="ksh__keys">
                                    <template v-for="(step, i) in entry.steps" :key="i">
                                        <span v-if="i" class="ksh__then">{{ $t('Shortcuts.then') }}</span>
                                        <kbd v-for="cap in step" :key="cap" class="ksh__kbd">{{ cap }}</kbd>
                                    </template>
                                </dd>
                            </div>
                        </dl>
                    </section>
                </div>
            </div>
        </div>
    </teleport>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useNavItems } from "@/components/organisms/Shell/navItems";
import { isMacPlatform, openPalette } from "@/components/molecules/AdvanceSearch/paletteKeys";
import { useFocusTrap } from "@/composable/useFocusTrap";
import {
    SHORTCUTS,
    SHORTCUT_GROUPS,
    bindShortcut,
    closeShortcutSheet,
    openShortcutSheet,
    shortcutPrefs,
    shortcutSheet,
    syncShortcutPreferences
} from "@/composable/shortcuts";

defineOptions({ name: "KeyboardShortcuts" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { getters } = useStore();
const companyId = inject("$companyId");
const userId = inject("$userId");
const { rail } = useNavItems(companyId);

const headingId = "ksh-title";
const dialogEl = ref(null);
useFocusTrap(dialogEl, computed(() => shortcutSheet.open));

const myRecord = computed(() => (getters["users/users"] || []).find((u) => u._id === userId.value));
watch(() => myRecord.value && myRecord.value.accessibilityPreferences, (stored) => {
    if (myRecord.value) syncShortcutPreferences(stored);
}, { immediate: true, deep: true });

const railItem = (key) => rail.value.find((item) => item.key === key && item.to);

const mac = isMacPlatform();
const KEY_NAMES = { Escape: "Shortcuts.key_escape", Enter: "Shortcuts.key_enter", shift: "Shortcuts.key_shift" };
const capOf = (token) => {
    if (token === "mod") return mac ? "⌘" : t("Shortcuts.key_ctrl");
    return KEY_NAMES[token] ? t(KEY_NAMES[token]) : token;
};

const groups = computed(() => SHORTCUT_GROUPS.map((id) => ({
    id,
    entries: SHORTCUTS
        .filter((s) => s.group === id && (!s.nav || railItem(s.nav)))
        .map((s) => ({ ...s, steps: s.keys.map((step) => step.split("+").map(capOf)) }))
})).filter((g) => g.entries.length));

const PAGE_SEARCH = "[data-page-search], input[type=\"search\"], [role=\"search\"] input";

function pageSearchBox() {
    const main = document.getElementById("ah-main");
    if (!main) return null;
    return Array.from(main.querySelectorAll(PAGE_SEARCH)).find((el) => !el.disabled
        && !el.closest("[hidden], [inert], [aria-hidden=\"true\"], [role=\"dialog\"]")
        && (typeof el.checkVisibility !== "function" || el.checkVisibility())) || null;
}

function focusSearch() {
    const box = pageSearchBox();
    if (box) {
        box.focus();
        if (typeof box.select === "function") box.select();
        return true;
    }
    if (route.meta && route.meta.preventAdvanceSearch) return false;
    openPalette();
    return true;
}

function go(key) {
    const item = railItem(key);
    if (!item) return false;
    router.push(item.to);
    return true;
}

const unbinds = [];
onMounted(() => {
    unbinds.push(bindShortcut("help", () => {
        if (shortcutSheet.open) return false;
        openShortcutSheet();
    }));
    unbinds.push(bindShortcut("search", focusSearch));
    SHORTCUTS.filter((s) => s.nav).forEach((s) => unbinds.push(bindShortcut(s.id, () => go(s.nav))));
});
onBeforeUnmount(() => {
    unbinds.splice(0).forEach((unbind) => unbind());
    closeShortcutSheet();
});
</script>

<style scoped>
.ksh-layer { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px; }
.ksh-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .36); }
.ksh {
    position: relative; width: min(720px, 100%); max-height: min(640px, calc(100dvh - 32px)); overflow: auto;
    background: var(--surface); color: var(--ink); border: 1px solid var(--hairline); border-radius: var(--r-modal);
    box-shadow: var(--shadow-modal); padding: 18px 20px 20px;
}
.ksh:focus { outline: none; }
.ksh__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.ksh__close {
    width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px;
    background: transparent; color: var(--ink-2); cursor: pointer;
}
.ksh__close:hover { background: var(--surface-hover); color: var(--ink); }
.ksh__close:focus-visible { outline: none; box-shadow: var(--focus); }
.ksh__note { margin: 0 0 10px; padding: 8px 10px; border-radius: 8px; background: var(--warn-bg); color: var(--warn-ink); font: var(--text-small); }
.ksh__groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; }
.ksh__group-title { margin: 0 0 6px; }
.ksh__list { margin: 0; }
.ksh__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--hairline); }
.ksh__row:last-child { border-bottom: 0; }
.ksh__label { font: var(--text-body); color: var(--ink); margin: 0; }
.ksh__keys { display: inline-flex; align-items: center; gap: 4px; margin: 0; flex: none; }
.ksh__then { font: var(--text-small); color: var(--ink-2); }
.ksh__kbd {
    min-width: 22px; padding: 2px 6px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 5px;
    background: var(--surface-2); color: var(--ink); font: var(--text-data); text-align: center;
}
@media (max-width: 767px) {
    .ksh__groups { grid-template-columns: 1fr; }
    .ksh__close { width: 44px; height: 44px; }
}
</style>
