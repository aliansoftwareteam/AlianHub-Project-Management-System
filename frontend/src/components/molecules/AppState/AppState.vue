<template>
    <section class="ah-state" :class="`ah-state--${kind}`" role="status">
        <div class="ah-state__card">
            <span class="ah-state__mark" :class="`ah-state__mark--${kind}`">
                <span v-if="kind === 'notfound'" class="ah-state__code">404</span>
                <ShellIcon v-else :name="ICON[kind]" :size="16" />
            </span>
            <h2 class="ah-state__title">{{ title || $t(`Inbox.state_${kind}_title`) }}</h2>
            <p class="ah-state__body">{{ body || $t(`Inbox.state_${kind}_body`) }}</p>
            <div v-if="kind === 'unreachable'" class="ah-state__meta">
                {{ $t('Inbox.state_retrying', { s: retryIn, n: attempt }) }}
            </div>
            <div class="ah-state__actions">
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="primary">
                    {{ primaryLabel || $t(`Inbox.state_${kind}_primary`) }}
                </button>
                <button
                    v-if="secondaryLabel || SECONDARY[kind]"
                    type="button"
                    class="ah-btn ah-btn--secondary ah-btn--sm"
                    @click="secondary"
                >{{ secondaryLabel || $t(`Inbox.state_${kind}_secondary`) }}</button>
            </div>
        </div>
    </section>
</template>

<script setup>
import { defineProps, defineEmits, inject } from 'vue';
import { useRouter } from 'vue-router';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { retryNow } from '@/offline';

defineOptions({ name: 'AppState' });

const props = defineProps({
    kind: { type: String, default: 'notfound', validator: (v) => ['offline', 'unreachable', 'forbidden', 'notfound'].includes(v) },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    primaryLabel: { type: String, default: '' },
    secondaryLabel: { type: String, default: '' },
    retryIn: { type: Number, default: 8 },
    attempt: { type: Number, default: 1 },
    backTo: { type: Object, default: null },
});
const emit = defineEmits(['primary', 'secondary']);

const ICON = { offline: 'wifiOff', unreachable: 'alert', forbidden: 'lock', notfound: 'search' };
const SECONDARY = { offline: false, unreachable: true, forbidden: true, notfound: true };

const router = useRouter();
const companyId = inject('$companyId', null);

const goHome = () => {
    const cid = companyId?.value || localStorage.getItem('selectedCompany') || '';
    if (props.backTo) return router.push(props.backTo).catch(() => {});
    if (cid && router.hasRoute('Home')) return router.push({ name: 'Home', params: { cid } }).catch(() => {});
    return router.push('/').catch(() => {});
};

const primary = () => {
    emit('primary');
    if (props.kind === 'unreachable' || props.kind === 'offline') retryNow();
    else if (props.kind === 'notfound') goHome();
};
const secondary = () => {
    emit('secondary');
    if (props.kind === 'forbidden' || props.kind === 'notfound') goHome();
};
</script>

<style scoped>
.ah-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: 24px;
    background: var(--canvas);
    box-sizing: border-box;
}
.ah-state__card {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 18px 20px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card);
}
.ah-state__mark {
    width: 30px; height: 30px; border-radius: 8px;
    display: inline-grid; place-items: center;
    background: rgba(0, 0, 0, .06); color: var(--ink-2);
}
.ah-state__mark--offline, .ah-state__mark--unreachable { background: var(--danger-bg); color: var(--danger-ink); }
.ah-state__mark--forbidden { background: var(--warn-bg); color: var(--warn-ink); }
.ah-state__mark--notfound { background: var(--brand-tint); color: var(--brand); }
.ah-state__code { font: 600 12px/1 var(--font-mono); }
.ah-state__title { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.ah-state__body { margin: 0; font: 400 12.5px/1.45 var(--font-ui); color: var(--ink-label); }
.ah-state__meta { font: 400 10.5px/1.4 var(--font-mono); color: var(--ink-2); margin-top: 4px; }
.ah-state__actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
</style>
