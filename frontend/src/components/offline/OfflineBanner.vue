<template>
    <transition name="ah-fade">
        <div v-if="show" class="ah-off">
            <div class="ah-off__strip" :class="{ 'is-sync': !away }">
                <span class="ah-dot" :class="away ? 'ah-dot--warn' : 'ah-dot--ok'"></span>
                <span class="ah-off__text">
                    <strong v-if="away">{{ $t('InboxV2.off_title') }}</strong>
                    <template v-if="away"> — {{ $t('InboxV2.off_keep_working') }} </template>
                    <template v-if="syncing">{{ $t('InboxV2.off_syncing', { n: pendingCount }) }}</template>
                    <template v-else-if="pendingCount">{{ $t('InboxV2.off_queued', { n: pendingCount }) }}</template>
                    <template v-if="conflicts.length"> · {{ $t('InboxV2.off_conflicts_n', { n: conflicts.length }) }}</template>
                </span>
                <button type="button" class="ah-off__review" @click="open = !open">
                    {{ open ? $t('InboxV2.off_hide_queue') : $t('InboxV2.off_review_queue') }}
                </button>
            </div>

            <transition name="ah-fade">
                <div v-if="open" class="ah-off__sheet ah-scroll" role="dialog" :aria-label="$t('InboxV2.off_title')">
                    <div class="ah-off__grid">
                        <div class="ah-card ah-off__card">
                            <div class="ah-off__card-title"><span class="ah-dot ah-dot--ok"></span>{{ $t('InboxV2.off_still_works') }}</div>
                            <div class="ah-off__card-body">{{ $t('InboxV2.off_still_works_list') }}</div>
                        </div>
                        <div class="ah-card ah-off__card">
                            <div class="ah-off__card-title"><span class="ah-dot ah-off__dot-muted"></span>{{ $t('InboxV2.off_needs_server') }}</div>
                            <div class="ah-off__card-body">{{ $t('InboxV2.off_needs_server_list') }}</div>
                        </div>
                    </div>

                    <div class="ah-card ah-off__card">
                        <div class="ah-off__row-head">
                            <span class="ah-off__card-title">{{ $t('InboxV2.off_queued_changes') }}</span>
                            <span class="ah-off__meta">{{ queue.length }}<template v-if="oldest"> · {{ $t('InboxV2.off_oldest', { t: oldest }) }}</template></span>
                        </div>
                        <div v-if="!queue.length" class="ah-off__card-body">{{ $t('InboxV2.off_queue_empty') }}</div>
                        <div v-for="q in visibleQueue" :key="q.id" class="ah-off__row" :class="{ 'is-held': q.held }">
                            <span class="ah-off__tag">{{ q.tag }}</span>
                            <span class="ah-off__row-text">{{ q.text || q.endPoint }}</span>
                            <span v-if="q.attempts" class="ah-off__meta">{{ $t('InboxV2.off_attempt', { n: q.attempts }) }}</span>
                            <span class="ah-off__meta">{{ stamp(q.at) }}</span>
                        </div>
                        <div v-if="queue.length > visibleQueue.length" class="ah-off__row ah-off__row--more">
                            <span class="ah-off__tag">+{{ queue.length - visibleQueue.length }}</span>
                            <span class="ah-off__row-text">{{ $t('InboxV2.off_more_changes', { n: queue.length - visibleQueue.length }) }}</span>
                        </div>
                    </div>

                    <div v-if="conflicts.length" class="ah-card ah-off__card ah-off__card--conflict">
                        <div class="ah-off__card-title ah-off__card-title--warn">{{ $t('InboxV2.off_conflicts_title', { n: conflicts.length }) }}</div>
                        <div v-for="c in conflicts" :key="c.id" class="ah-off__conflict">
                            <div class="ah-off__card-body">
                                <i18n-t keypath="InboxV2.off_conflict_line" tag="span" scope="global">
                                    <template #task><strong>{{ c.taskKey || c.taskId }}</strong></template>
                                    <template #mine>{{ valueOf(c.fields[0].mine) }}</template>
                                    <template #mineAt>{{ stamp(c.mineAt) }}</template>
                                    <template #who>{{ c.theirsBy || $t('InboxV2.off_someone') }}</template>
                                    <template #theirs>{{ valueOf(c.fields[0].theirs) }}</template>
                                    <template #theirsAt>{{ stamp(c.theirsAt) }}</template>
                                </i18n-t>
                            </div>
                            <div class="ah-off__actions">
                                <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="decide(c, 'mine')">{{ $t('InboxV2.off_keep_mine') }}</button>
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="decide(c, 'theirs')">{{ $t('InboxV2.off_keep_theirs', { who: c.theirsBy || $t('InboxV2.off_theirs') }) }}</button>
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="decide(c, 'open')">{{ $t('InboxV2.off_open_decide') }}</button>
                            </div>
                        </div>
                        <div class="ah-off__hint">{{ $t('InboxV2.off_conflict_hint') }}</div>
                    </div>

                    <div class="ah-card ah-off__retry">
                        <span class="ah-off__spinner" :class="{ 'is-spinning': syncing || away }"></span>
                        <div class="ah-off__retry-text">
                            <strong>{{ $t('InboxV2.off_retry_every', { s: RETRY_S }) }}</strong>
                            <span class="ah-muted">
                                {{ $t('InboxV2.off_stored_on_device') }}
                                <span v-if="away" class="ah-off__meta">· {{ $t('InboxV2.state_retrying', { s: retryIn || RETRY_S, n: attempt }) }}</span>
                            </span>
                        </div>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="syncing" @click="retryNow()">{{ $t('InboxV2.off_retry_now') }}</button>
                    </div>
                </div>
            </transition>
        </div>
    </transition>
</template>

<script setup>
import { computed, ref, inject } from 'vue';
import { useRouter } from 'vue-router';
import { away, isOnline, pendingCount, syncing, queue, conflicts, attempt, retryIn, retryNow, resolveConflict } from '@/offline';
import { RETRY_EVERY_MS } from '@/offline/offlineRules';

defineOptions({ name: 'OfflineBanner' });

const router = useRouter();
const companyId = inject('$companyId', null);
const RETRY_S = RETRY_EVERY_MS / 1000;
const open = ref(false);

const show = computed(() => away.value || !isOnline.value || syncing.value || pendingCount.value > 0 || conflicts.value.length > 0);
const visibleQueue = computed(() => queue.value.slice(0, 3));
const oldest = computed(() => {
    if (!queue.value.length) return '';
    const at = Math.min(...queue.value.map((q) => q.at || Date.now()));
    const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
    return mins < 60 ? `${mins} MIN AGO` : `${Math.round(mins / 60)} H AGO`;
});

const stamp = (ms) => {
    const d = new Date(ms || 0);
    return Number.isNaN(d.getTime()) || !ms ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const valueOf = (v) => {
    if (v && typeof v === 'object') return v.text || v.name || v.key || JSON.stringify(v);
    return v == null ? '—' : String(v);
};

const decide = async (c, choice) => {
    const result = await resolveConflict(c.id, choice);
    if (choice !== 'open' || !result) return;
    const cid = companyId?.value || '';
    if (cid && result.taskId && result.projectId && result.sprintId) {
        const base = `/${cid}/project/${result.projectId}`;
        const path = result.folderId
            ? `${base}/fs/${result.folderId}/${result.sprintId}/${result.taskId}`
            : `${base}/s/${result.sprintId}/${result.taskId}`;
        router.push(path).catch(() => {});
    }
    open.value = false;
};
</script>

<style scoped>
.ah-off { position: fixed; top: 0; left: 0; right: 0; z-index: 99999; font-family: var(--font-ui); }
.ah-off__strip {
    height: 36px; display: flex; align-items: center; gap: 10px;
    padding: 0 18px; background: var(--rail); color: #fff; font-size: 12px;
}
.ah-off__strip.is-sync .ah-off__text { color: rgba(255, 255, 255, .85); }
.ah-off__text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-off__review { border: 0; background: transparent; color: #a892ff; font: 600 12px/1 var(--font-ui); cursor: pointer; padding: 6px 0; }
.ah-off__sheet {
    max-height: calc(100dvh - 36px); overflow: auto;
    padding: 18px 20px; display: flex; flex-direction: column; gap: 12px;
    background: var(--canvas); border-bottom: 1px solid var(--hairline); box-shadow: var(--shadow-pop);
    color: var(--ink); font-size: 12.5px;
}
.ah-off__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ah-off__card { padding: 13px 15px; display: flex; flex-direction: column; gap: 8px; }
.ah-off__card--conflict { border: 1.5px solid var(--warn); }
.ah-off__card-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 7px; }
.ah-off__card-title--warn { color: var(--warn-ink); }
.ah-off__card-body { color: var(--ink-label); line-height: 1.55; }
.ah-off__dot-muted { background: rgba(0, 0, 0, .3); }
.ah-off__row-head { display: flex; align-items: center; justify-content: space-between; }
.ah-off__row { display: flex; align-items: center; gap: 9px; }
.ah-off__row.is-held { opacity: .55; }
.ah-off__row--more { color: var(--ink-2); }
.ah-off__row-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ah-off__tag {
    font: 600 9.5px/1 var(--font-mono); padding: 4px 6px; border-radius: 4px;
    background: rgba(0, 0, 0, .06); color: var(--ink-label); width: 62px; text-align: center; box-sizing: border-box; flex: none;
}
.ah-off__meta { font: 500 10.5px/1 var(--font-mono); color: var(--ink-2); white-space: nowrap; }
.ah-off__conflict { display: flex; flex-direction: column; gap: 9px; }
.ah-off__actions { display: flex; gap: 6px; flex-wrap: wrap; }
.ah-off__hint { font-size: 11.5px; color: var(--ink-2); line-height: 1.45; }
.ah-off__retry { display: flex; align-items: center; gap: 10px; padding: 11px 13px; }
.ah-off__retry-text { flex: 1; line-height: 1.45; display: flex; flex-direction: column; }
.ah-off__spinner {
    width: 22px; height: 22px; border-radius: 50%; flex: none;
    border: 2.5px solid var(--brand-ring); border-top-color: var(--brand);
}
.ah-off__spinner.is-spinning { animation: ah-off-spin 1s linear infinite; }
@keyframes ah-off-spin { to { transform: rotate(360deg); } }
@media (max-width: 767px) { .ah-off__grid { grid-template-columns: 1fr; } }
</style>
