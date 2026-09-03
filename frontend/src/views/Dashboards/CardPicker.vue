<template>
    <div class="dpick" role="dialog" aria-modal="true" :aria-label="$t('DashV2.add_card')" @click.self="$emit('close')">
        <div class="dpick__panel">
            <header class="dpick__head">
                <h2 class="ah-h2">{{ $t('DashV2.add_card') }}</h2>
                <p class="dpick__lede">{{ $t('DashV2.picker_lede', { built: builtCount, total: totalCount }) }}</p>
                <input
                    ref="searchInput"
                    v-model="search"
                    type="search"
                    class="ah-input dpick__search"
                    :placeholder="$t('DashV2.search_cards')"
                />
                <button type="button" class="dpick__close" :title="$t('DashV2.close')" @click="$emit('close')">
                    <ShellIcon name="x" :size="15" />
                </button>
            </header>

            <div class="dpick__body ah-scroll">
                <section v-for="family in families" :key="family.id" class="dpick__family">
                    <div class="dpick__family-head">
                        <span class="ah-label">{{ $t(family.labelKey) }}</span>
                        <span class="dpick__question">{{ $t(family.questionKey) }}</span>
                    </div>
                    <div class="dpick__grid">
                        <article
                            v-for="entry in family.cards"
                            :key="entry.key"
                            class="dpick__card"
                            :class="{ 'is-disabled': !entry.built, 'is-added': added.includes(entry.key) }"
                        >
                            <div class="dpick__card-title">{{ $t(entry.titleKey) }}</div>
                            <p class="dpick__card-answer">{{ $t(entry.answerKey) }}</p>
                            <div class="dpick__card-foot">
                                <span class="ah-chip ah-chip--mono">{{ $t(entry.scopeKey) }}</span>
                                <button
                                    v-if="entry.built"
                                    type="button"
                                    class="ah-btn ah-btn--outline ah-btn--sm dpick__add"
                                    @click="$emit('add', entry)"
                                >{{ added.includes(entry.key) ? $t('DashV2.add_again') : $t('DashV2.add') }}</button>
                                <span v-else class="ah-chip dpick__soon">{{ $t('DashV2.not_built') }}</span>
                            </div>
                        </article>
                    </div>
                </section>

                <p v-if="!families.length" class="ah-empty dpick__none">{{ $t('DashV2.no_cards_match', { q: search }) }}</p>
            </div>

            <footer class="dpick__foot">{{ $t('DashV2.picker_footer') }}</footer>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { CARD_FAMILIES, CARD_CATALOG } from '@/plugins/dashboard/cardCatalog';

defineOptions({ name: 'CardPicker' });

defineProps({
    added: { type: Array, default: () => [] },
});
defineEmits(['add', 'close']);

const { t } = useI18n();
const search = ref('');
const searchInput = ref(null);

const totalCount = CARD_CATALOG.length;
const builtCount = CARD_CATALOG.filter((c) => c.built).length;

const matches = (entry) => {
    const q = search.value.trim().toLowerCase();
    if (!q) return true;
    return `${t(entry.titleKey)} ${t(entry.answerKey)}`.toLowerCase().includes(q);
};

const families = computed(() => CARD_FAMILIES
    .map((f) => ({ ...f, cards: CARD_CATALOG.filter((c) => c.family === f.id && matches(c)) }))
    .filter((f) => f.cards.length));

onMounted(() => searchInput.value && searchInput.value.focus());
</script>

<style scoped>
.dpick {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, .38);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
}
.dpick__panel {
    width: min(920px, 100%);
    max-height: min(680px, 92vh);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--r-modal);
    box-shadow: var(--shadow-modal);
    overflow: hidden;
}
.dpick__head {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--hairline);
}
.dpick__lede { margin: 0; font: var(--text-small); color: var(--ink-2); }
.dpick__search { width: 220px; height: 34px; }
.dpick__close {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--r-chip);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
}
.dpick__close:hover { background: var(--surface-hover); color: var(--ink); }
.dpick__body { padding: 16px 20px 20px; overflow: auto; display: flex; flex-direction: column; gap: 20px; }
.dpick__family-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 9px; }
.dpick__question { font: var(--text-small); color: var(--ink-2); }
.dpick__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(224px, 1fr)); gap: 10px; }
.dpick__card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 11px 13px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-input);
    background: var(--surface);
}
.dpick__card.is-added { border-color: var(--brand); background: var(--brand-tint); }
.dpick__card.is-disabled { background: var(--surface-2); }
.dpick__card-title { font: var(--text-h3); color: var(--ink); }
.dpick__card.is-disabled .dpick__card-title { color: var(--ink-2); }
.dpick__card-answer { margin: 0; font: var(--text-small); font-size: 12px; color: var(--ink-2); line-height: 1.45; flex: 1 1 auto; }
.dpick__card-foot { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.dpick__add { margin-left: auto; }
.dpick__soon { margin-left: auto; background: var(--surface-hover); color: var(--ink-label); }
.dpick__none { margin: 30px auto; }
.dpick__foot {
    padding: 11px 20px;
    border-top: 1px solid var(--hairline);
    font: var(--text-small);
    font-size: 11.5px;
    color: var(--ink-2);
}
@media (max-width: 768px) {
    .dpick { padding: 0; }
    .dpick__panel { max-height: 100vh; height: 100%; border-radius: 0; }
    .dpick__head { grid-template-columns: 1fr; }
    .dpick__search { width: 100%; }
}
</style>
