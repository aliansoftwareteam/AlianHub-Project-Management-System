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
                <label v-for="card in HOME_CARDS" :key="card.id" class="ah-pop__item hcm__option" data-test="home-card-option">
                    <input
                        type="checkbox"
                        class="ah-check"
                        :checked="isHomeCardShown(card.id)"
                        :disabled="saving"
                        @change="toggle(card.id, $event.target.checked)"
                    />
                    <span class="hcm__text">
                        <span>{{ $t(card.labelKey) }}</span>
                        <span class="hcm__hint">{{ $t(card.hintKey) }}</span>
                    </span>
                </label>
                <template v-if="router.hasRoute('Dashboards')">
                    <div class="ah-pop__sep"></div>
                    <router-link class="ah-pop__item" data-test="home-cards-dashboards" :to="{ name: 'Dashboards', params: { cid: companyId } }" @click="close">
                        <ShellIcon name="reports" :size="14" /><span>{{ $t('Home.open_dashboards') }}</span>
                    </router-link>
                </template>
            </div>
        </transition>
    </div>
</template>

<script setup>
import { inject, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { HOME_CARDS, isHomeCardShown, setHomeCardShown } from "./homeCards";

defineOptions({ name: "HomeCardsMenu" });

const router = useRouter();
const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const root = ref(null);
const open = ref(false);
const saving = ref(false);

const close = () => { open.value = false; };

async function toggle(id, shown) {
    saving.value = true;
    try {
        await setHomeCardShown(id, shown);
    } catch (error) {
        $toast.error(t("Home.cards_save_failed"), { position: "top-right" });
    } finally {
        saving.value = false;
    }
}

const onDocumentClick = (event) => {
    if (open.value && root.value && !root.value.contains(event.target)) close();
};

onMounted(() => document.addEventListener("click", onDocumentClick));
onUnmounted(() => document.removeEventListener("click", onDocumentClick));
</script>

<style scoped>
.hcm__pop { min-width: 260px; }
.hcm__option { align-items: flex-start; }
.hcm__option .ah-check { margin-top: 1px; flex: none; }
.hcm__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hcm__hint { font: 400 11.5px/1.4 var(--font-ui); color: var(--ink-2); white-space: normal; }
.hcm__icon { display: none; }
@media (max-width: 991px) {
    .hcm__label { display: none; }
    .hcm__icon { display: inline-flex; }
    .hcm__toggle { width: 44px; justify-content: center; padding: 0; }
}
</style>
