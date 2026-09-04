<template>
    <Teleport to="body">
        <div ref="root" class="pp" tabindex="-1">
            <div class="pp__stage">
                <div v-if="!slides.length" class="pp__empty">{{ $t('Docs.nothing_to_present') }}</div>
                <div v-else class="pp__slide">
                    <div class="pp__kicker">{{ kicker }}</div>
                    <h1 class="pp__heading">{{ current.heading || title }}</h1>
                    <div class="pp__body" v-html="bodyHtml"></div>
                </div>
            </div>
            <div class="pp__bar">
                <span class="pp__from">
                    {{ $t('Docs.presenting_from') }} <strong>{{ title }}</strong> · {{ $t('Docs.headings_became_slides') }}
                </span>
                <div class="pp__ctrl">
                    <span class="pp__count">{{ $t('Docs.slide_of', { n: slides.length ? index + 1 : 0, total: slides.length }) }}</span>
                    <button type="button" class="pp__btn" :disabled="index <= 0" @click="prev"><ShellIcon name="arrowLeft" :size="14" /></button>
                    <button type="button" class="pp__btn" :disabled="index >= slides.length - 1" @click="next"><ShellIcon name="arrowRight" :size="14" /></button>
                    <button type="button" class="pp__btn pp__btn--strong" @click="$emit('close')">{{ $t('Docs.exit_present') }} <span class="ah-kbd pp__kbd">Esc</span></button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import pageContent from '@pageContent';

const { blocksToSlides, blocksToHtml, escapeHtml } = pageContent.default || pageContent;

defineOptions({ name: 'PagePresenter' });

const props = defineProps({
    title: { type: String, default: '' },
    blocks: { type: Object, default: null },
    projectName: { type: String, default: '' },
});

const emit = defineEmits(['close']);

const root = ref(null);
const index = ref(0);

const slides = computed(() => blocksToSlides(props.blocks || [], props.title));
const current = computed(() => slides.value[index.value] || { heading: '', blocks: [] });
const kicker = computed(() => [props.projectName, props.title].filter(Boolean).join(' · ').toUpperCase());

const bodyHtml = computed(() => current.value.blocks.map((block) => {
    if (block.type === 'task') {
        return `<p class="pp__task"><span class="pp__key">${escapeHtml(block.data.taskKey)}</span>${escapeHtml(block.data.title)}</p>`;
    }
    if (block.type === 'taskList') {
        return `<p class="pp__task">${escapeHtml(block.data.projectName)}</p>`;
    }
    return blocksToHtml([block]);
}).join(''));

function next() { if (index.value < slides.value.length - 1) index.value += 1; }
function prev() { if (index.value > 0) index.value -= 1; }

function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); emit('close'); return; }
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); next(); }
    if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); prev(); }
}

onMounted(() => {
    window.addEventListener('keydown', onKey);
    if (root.value) root.value.focus();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.pp {
    position: fixed; inset: 0; z-index: 1200;
    background: var(--rail); color: var(--rail-ink-strong);
    display: flex; flex-direction: column;
    font-family: var(--font-ui);
    outline: none;
}
.pp__stage { flex: 1; min-height: 0; display: grid; place-items: center; padding: 48px 8vw; overflow: auto; }
.pp__slide { width: 100%; max-width: 1100px; display: flex; flex-direction: column; gap: 24px; }
.pp__kicker { font: 500 14px var(--font-mono); letter-spacing: .08em; color: var(--rail-ink); }
.pp__heading { margin: 0; font: 600 clamp(32px, 4.2vw, 56px)/1.15 var(--font-ui); letter-spacing: -.02em; color: var(--rail-ink-strong); }
.pp__body { font-size: 26px; line-height: 1.55; color: var(--rail-ink); max-width: 62ch; }
.pp__body :deep(p) { margin: 0 0 16px; }
.pp__body :deep(h3), .pp__body :deep(h4), .pp__body :deep(h5), .pp__body :deep(h6) { font-size: 30px; font-weight: 600; color: var(--rail-ink-strong); margin: 8px 0 12px; }
.pp__body :deep(ul), .pp__body :deep(ol) { margin: 0 0 16px; padding-left: 1.2em; }
.pp__body :deep(li) { margin-bottom: 8px; }
.pp__body :deep(aside) { padding: 16px 20px; border-radius: 12px; background: var(--rail-active); margin: 0 0 16px; }
.pp__body :deep(pre) { font: 500 24px/1.5 var(--font-mono); background: var(--rail-hover); padding: 16px 20px; border-radius: 12px; overflow: auto; }
.pp__body :deep(blockquote) { margin: 0 0 16px; padding-left: 20px; border-left: 4px solid var(--rail-ink); }
.pp__body :deep(table) { border-collapse: collapse; font-size: 24px; }
.pp__body :deep(td) { padding: 8px 14px; border: 1px solid var(--rail-hover); }
.pp__body :deep(img) { max-width: 100%; border-radius: 12px; }
.pp__body :deep(hr) { border: 0; height: 1px; background: var(--rail-hover); margin: 16px 0; }
.pp__body :deep(.pp__task) { display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-radius: 12px; background: var(--rail-hover); color: var(--rail-ink-strong); }
.pp__body :deep(.pp__key) { font: 600 24px var(--font-mono); color: var(--rail-ink); }
.pp__empty { font-size: 26px; color: var(--rail-ink); max-width: 40ch; text-align: center; line-height: 1.5; }

.pp__bar {
    height: 52px; flex: none;
    border-top: 1px solid var(--rail-hover);
    display: flex; align-items: center; gap: 12px; padding: 0 22px;
    font-size: 12px;
}
.pp__from { color: var(--rail-ink); }
.pp__from strong { color: var(--rail-ink-strong); font-weight: 600; }
.pp__ctrl { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.pp__count { font: 500 11px var(--font-mono); color: var(--rail-ink); margin-right: 4px; }
.pp__btn {
    height: 30px; padding: 0 10px; border-radius: 7px;
    border: 1px solid rgba(255, 255, 255, .2); background: transparent; color: var(--rail-ink-strong);
    display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font: 500 12px var(--font-ui);
    transition: background var(--t-state) var(--ease);
}
.pp__btn:hover:not(:disabled) { background: var(--rail-hover); }
.pp__btn:disabled { opacity: .4; cursor: default; }
.pp__btn--strong { background: var(--rail-active); border-color: transparent; font-weight: 600; }
.pp__kbd { background: transparent; color: var(--rail-ink); border-color: rgba(255, 255, 255, .2); }

@media (max-width: 767px) {
    .pp__stage { padding: 24px 20px; }
    .pp__body { font-size: 24px; }
    .pp__from { display: none; }
}
</style>
