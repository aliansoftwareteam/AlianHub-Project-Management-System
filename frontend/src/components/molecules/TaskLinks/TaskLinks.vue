<template>
    <div v-if="shown.length" class="tkl mobile__bg--withPadding mt-10px" data-test="task-links">
        <span class="tkl__title">{{ $t('Projects.links') }}</span>
        <ul class="tkl__list">
            <li v-for="link in shown" :key="link.key">
                <a class="tkl__link" :href="link.href" :title="link.href" target="_blank" rel="noopener noreferrer">{{ link.label }}</a>
            </li>
        </ul>
    </div>
</template>

<script setup>
import { computed, defineProps } from "vue";
import { safeHref } from "@fieldTypes/url";

defineOptions({ name: "TaskLinks" });

/* The links an agent, an API caller or an import attached to the task (`task.links`). Read only. */
const props = defineProps({
    links: { type: Array, default: () => [] }
});

const shown = computed(() => (Array.isArray(props.links) ? props.links : [])
    .map((link, index) => ({ key: String(link?._id || index), href: safeHref(link?.url), label: String(link?.label || "").trim() }))
    .filter((link) => link.href)
    .map((link) => ({ ...link, label: link.label || link.href })));
</script>

<style scoped>
.tkl { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tkl__title { font-weight: 600; font-size: var(--text-small, 13px); color: var(--ink); }
.tkl__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.tkl__link { color: var(--brand); font-size: var(--text-small, 13px); overflow-wrap: anywhere; text-decoration: none; }
.tkl__link:hover, .tkl__link:focus-visible { text-decoration: underline; }
</style>
