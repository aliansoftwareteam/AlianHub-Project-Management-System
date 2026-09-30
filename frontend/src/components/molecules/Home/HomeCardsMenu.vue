<template>
    <div ref="root" class="ah-pop-anchor hcm" @keydown.esc="close">
        <button
            type="button"
            class="ah-tbtn ah-tbtn--strong hcm__toggle"
            data-test="home-cards-toggle"
            :aria-label="$t('Home.manage_cards')"
            :title="$t('Home.manage_cards')"
            :aria-expanded="open ? 'true' : 'false'"
            @click="open = !open"
        >
            <ShellIcon name="layout" :size="14" class="hcm__icon" />
            <span class="hcm__label">{{ $t('Home.manage_cards') }}</span>
        </button>
        <transition name="ah-fade">
            <div v-if="open" class="ah-pop hcm__pop" role="group" :aria-label="$t('Home.manage_cards')">
                <div class="ah-label ah-pop__label">{{ $t('Home.cards_on_home') }}</div>
                <ol v-if="rows.length" class="hcm__list" :aria-label="$t('Home.cards_on_home')">
                    <li
                        v-for="(card, index) in rows"
                        :key="card.id"
                        class="hcm__row"
                        :class="{ 'is-dragging': dragId === card.id, 'is-target': overId === card.id && dragId !== card.id }"
                        data-test="home-card-row"
                        :data-card="card.id"
                        :draggable="!saving"
                        @dragstart="onDragStart($event, card.id)"
                        @dragover.prevent="onDragOver($event, card.id)"
                        @drop.prevent="onDrop(index)"
                        @dragend="clearDrag"
                    >
                        <ShellIcon name="grip" :size="14" class="hcm__grip" aria-hidden="true" />
                        <span class="hcm__text">
                            <span>{{ $t(card.labelKey) }}</span>
                            <span class="hcm__hint">{{ $t(card.hintKey) }}</span>
                        </span>
                        <span class="hcm__tools">
                            <button
                                type="button"
                                class="hcm__tool hcm__tool--up"
                                data-test="home-card-up"
                                :aria-label="$t('Home.move_card_up', { card: $t(card.labelKey) })"
                                :title="$t('Home.move_card_up', { card: $t(card.labelKey) })"
                                :disabled="saving || index === 0"
                                @click="move(card.id, index - 1)"
                            ><ShellIcon name="chevron" :size="13" /></button>
                            <button
                                type="button"
                                class="hcm__tool hcm__tool--down"
                                data-test="home-card-down"
                                :aria-label="$t('Home.move_card_down', { card: $t(card.labelKey) })"
                                :title="$t('Home.move_card_down', { card: $t(card.labelKey) })"
                                :disabled="saving || index === rows.length - 1"
                                @click="move(card.id, index + 1)"
                            ><ShellIcon name="chevron" :size="13" /></button>
                            <button
                                type="button"
                                class="hcm__tool"
                                data-test="home-card-remove"
                                :aria-label="$t('Home.remove_card', { card: $t(card.labelKey) })"
                                :title="$t('Home.remove_card', { card: $t(card.labelKey) })"
                                :disabled="saving"
                                @click="remove(card.id)"
                            ><ShellIcon name="x" :size="13" /></button>
                        </span>
                    </li>
                </ol>
                <p v-else class="hcm__empty" data-test="home-cards-empty">{{ $t('Home.no_cards') }}</p>
                <p class="ah-sr-only" aria-live="polite">{{ announcement }}</p>
                <div class="ah-pop__sep"></div>
                <button type="button" class="ah-pop__item" data-test="home-cards-add" :disabled="saving" @click="pickerOpen = true">
                    <ShellIcon name="plus" :size="14" /><span>{{ $t('Home.add_cards') }}</span>
                </button>
                <router-link v-if="router.hasRoute('Dashboards')" class="ah-pop__item" data-test="home-cards-dashboards" :to="{ name: 'Dashboards', params: { cid: companyId } }" @click="close">
                    <ShellIcon name="reports" :size="14" /><span>{{ $t('Home.open_dashboards') }}</span>
                </router-link>
            </div>
        </transition>
        <CardPicker
            v-if="pickerOpen"
            :entries="PICKER_ENTRIES"
            :families="PICKER_FAMILIES"
            :added="homeCards.layout"
            :repeatable="false"
            lede-key="Home.picker_lede"
            footer-key="Home.picker_footer"
            @add="add"
            @close="pickerOpen = false"
        />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import CardPicker from "@/views/Dashboards/CardPicker.vue";
import { CARD_FAMILIES } from "@/plugins/dashboard/cardCatalog";
import { HOME_CARDS, HOME_CATALOG_KEYS, addHomeCard, homeCardInfo, homeCards, moveHomeCard, removeHomeCard } from "./homeCards";

defineOptions({ name: "HomeCardsMenu" });

const PICKER_FAMILIES = [{ id: "home", labelKey: "Home.picker_family_home", questionKey: "Home.picker_family_home_q" }, ...CARD_FAMILIES];
const PICKER_ENTRIES = [
    ...HOME_CARDS.map((card) => ({ key: card.id, family: "home", built: true, titleKey: card.labelKey, answerKey: card.hintKey, scopeKey: "Dash.scope_mine" })),
    ...HOME_CATALOG_KEYS.map((key) => homeCardInfo(key)?.entry).filter(Boolean)
];

const router = useRouter();
const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const root = ref(null);
const open = ref(false);
const saving = ref(false);
const pickerOpen = ref(false);
const dragId = ref("");
const overId = ref("");
const announcement = ref("");

const rows = computed(() => homeCards.layout.map(homeCardInfo).filter(Boolean));

const close = () => {
    if (pickerOpen.value) return;
    open.value = false;
};

async function save(change, message) {
    saving.value = true;
    try {
        await change();
        announcement.value = message;
    } catch (error) {
        $toast.error(t("Home.cards_save_failed"), { position: "top-right" });
    } finally {
        saving.value = false;
    }
}

const labelOf = (id) => t(homeCardInfo(id)?.labelKey || id);
const move = (id, to) => save(() => moveHomeCard(id, to), t("Home.card_moved", { card: labelOf(id), n: to + 1 }));
const remove = (id) => save(() => removeHomeCard(id), t("Home.card_removed", { card: labelOf(id) }));
const add = (entry) => {
    pickerOpen.value = false;
    return save(() => addHomeCard(entry.key), t("Home.card_added", { card: labelOf(entry.key) }));
};

function onDragStart(event, id) {
    dragId.value = id;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
    }
}
function onDragOver(event, id) {
    if (!dragId.value) return;
    overId.value = id;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
const clearDrag = () => { dragId.value = ""; overId.value = ""; };
function onDrop(index) {
    const id = dragId.value;
    clearDrag();
    if (id) move(id, index);
}

const onDocumentClick = (event) => {
    if (open.value && !pickerOpen.value && root.value && !root.value.contains(event.target)) open.value = false;
};

onMounted(() => document.addEventListener("click", onDocumentClick));
onUnmounted(() => document.removeEventListener("click", onDocumentClick));
</script>

<style scoped>
.hcm__pop { min-width: 300px; max-width: min(360px, calc(100vw - 24px)); max-height: min(70vh, 560px); overflow-y: auto; }
.hcm__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.hcm__row {
    display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; border-radius: var(--r-chip);
    border: 1px solid transparent; background: var(--surface); cursor: grab;
}
.hcm__row.is-dragging { opacity: .5; }
.hcm__row.is-target { border-color: var(--brand); background: var(--brand-tint); }
.hcm__grip { flex: none; margin-top: 2px; color: var(--ink-label); }
.hcm__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; font: 500 13px/1.35 var(--font-ui); color: var(--ink); }
.hcm__hint { font: 400 11.5px/1.4 var(--font-ui); color: var(--ink-2); white-space: normal; }
.hcm__tools { display: inline-flex; gap: 2px; flex: none; }
.hcm__tool {
    width: 26px; height: 26px; display: grid; place-items: center;
    border: 0; border-radius: var(--r-chip); background: transparent; color: var(--ink-2); cursor: pointer;
}
.hcm__tool:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
.hcm__tool:focus-visible { outline: none; box-shadow: var(--focus); }
.hcm__tool:disabled { opacity: .35; cursor: default; }
.hcm__tool--up :deep(svg) { transform: rotate(-90deg); }
.hcm__tool--down :deep(svg) { transform: rotate(90deg); }
.hcm__empty { margin: 4px 8px 6px; font: 400 12.5px/1.4 var(--font-ui); color: var(--ink-2); }
.hcm__icon { display: none; }
@media (max-width: 991px) {
    .hcm__label { display: none; }
    .hcm__icon { display: inline-flex; }
    .hcm__toggle { width: 44px; justify-content: center; padding: 0; }
}
@media (max-width: 767px) {
    .hcm > .hcm__pop { position: fixed; left: 12px; right: 12px; top: 64px; min-width: 0; max-width: none; max-height: calc(100vh - 88px); overflow-y: auto; }
    .hcm__tool { width: 44px; height: 44px; }
    .hcm__row { align-items: center; }
}
</style>
