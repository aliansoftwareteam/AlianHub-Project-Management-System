<template>
    <section class="au-tpl" data-test="template-gallery" :aria-label="$t('AutomationTemplates.title')">
        <div class="au-tpl__head">
            <div class="au-tpl__heading">
                <h2 class="ah-h2">{{ $t('AutomationTemplates.title') }}</h2>
                <p class="ah-small au-tpl__sub">{{ $t('AutomationTemplates.sub') }}</p>
            </div>
            <button type="button" class="au__x" :aria-label="$t('AutomationTemplates.close')" :title="$t('AutomationTemplates.close')" @click="$emit('close')">×</button>
        </div>

        <div class="au-tpl__controls">
            <input
                v-model="query"
                type="search"
                class="ah-input au-tpl__search"
                data-test="template-search"
                :placeholder="$t('AutomationTemplates.search')"
                :aria-label="$t('AutomationTemplates.search')"
            />
            <label class="au-tpl__project">
                <span class="au__kw">{{ $t('AutomationTemplates.project') }}</span>
                <select :value="projectId" class="au__slot" data-test="template-project" @change="$emit('update:projectId', $event.target.value)">
                    <option value="">{{ $t('AutomationTemplates.all_projects') }}</option>
                    <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '—' }}</option>
                </select>
            </label>
        </div>

        <div class="au-tpl__cats" role="group" :aria-label="$t('AutomationTemplates.title')">
            <button
                v-for="c in ['all', ...CATEGORIES]"
                :key="c"
                type="button"
                class="au-tpl__cat"
                :class="{ 'is-on': category === c }"
                :aria-pressed="category === c"
                data-test="template-category"
                :data-category="c"
                @click="category = c"
            >{{ $t(`AutomationTemplates.category_${c}`) }}</button>
        </div>

        <p v-if="!groups.length" class="ah-small au-tpl__none" data-test="template-none">{{ $t('AutomationTemplates.none') }}</p>

        <div v-for="group in groups" :key="group.category" class="au-tpl__group">
            <h3 class="ah-label">{{ $t(`AutomationTemplates.category_${group.category}`) }}</h3>
            <ul class="au-tpl__grid">
                <li v-for="tpl in group.templates" :key="tpl.id" class="au-tpl__card" data-test="template-card" :data-id="tpl.id">
                    <strong class="au-tpl__name">{{ $t(tpl.nameKey) }}</strong>
                    <p class="ah-small au-tpl__desc">{{ $t(tpl.descriptionKey) }}</p>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="template-use" @click="$emit('use', tpl)">
                        {{ $t('AutomationTemplates.use') }}
                    </button>
                </li>
            </ul>
        </div>
    </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { TEMPLATES, CATEGORIES } from '@automationTemplates';

defineOptions({ name: 'AutomationTemplateGallery' });

defineProps({
    projects: { type: Array, default: () => [] },
    projectId: { type: String, default: '' },
});
defineEmits(['use', 'close', 'update:projectId']);

const { t } = useI18n();
const query = ref('');
const category = ref('all');

const fold = (s) => String(s ?? '').toLowerCase();

const groups = computed(() => {
    const words = fold(query.value).split(/\s+/).filter(Boolean);
    const matches = TEMPLATES.filter((tpl) => {
        if (category.value !== 'all' && tpl.category !== category.value) return false;
        const haystack = fold(`${t(tpl.nameKey)} ${t(tpl.descriptionKey)}`);
        return words.every((w) => haystack.includes(w));
    });
    return CATEGORIES
        .map((c) => ({ category: c, templates: matches.filter((tpl) => tpl.category === c) }))
        .filter((g) => g.templates.length);
});
</script>
