import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay, toast } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import InstanceKnowledge from '@/views/Settings/Instance/InstanceKnowledge.vue';

const BASE = '/api/v2/instance/knowledge';
const CID_A = '6f00000000000000000000a1';
const CID_B = '6f00000000000000000000b1';
const PAGE = '6f0000000000000000000d01';
const ALICE = '6f0000000000000000000011';
const WHEN = '2026-09-17T10:00:00.000Z';

const row = (companyId, name, over = {}) => ({
    companyId,
    name,
    modes: { indexer: 'on', retrieval: 'on' },
    sources: [{ sourceType: 'page', backfill: 'complete', reindex: '', stale: false }, { sourceType: 'file', backfill: 'running', reindex: '', stale: false }],
    ...over,
});

const summary = (over = {}) => ({
    indexer: { mode: 'tenant', envKey: 'KNOWLEDGE_INDEXER' },
    retrievalMode: 'tenant',
    reindexable: ['page', 'comment', 'transcript', 'guide', 'file'],
    documentTypes: ['page', 'comment', 'transcript', 'guide', 'file', 'task'],
    page: 1,
    pageSize: 20,
    total: 2,
    workspaces: [row(CID_A, 'Acme'), row(CID_B, 'Bolt')],
    ...over,
});

const source = (sourceType, over = {}) => ({
    sourceType,
    chunks: 0,
    tombstones: 0,
    sources: 0,
    textBytes: 0,
    lastIndexedAt: null,
    backfill: { status: 'complete', progress: null, indexed: 0, skipped: 0, startedAt: null, finishedAt: null },
    reindex: { status: '', progress: null, requestedAt: null, finishedAt: null, failing: false },
    freshness: { heartbeatAt: WHEN, behindMs: 60000, stale: false, catchUpFrom: null, catchUpBehindMs: null },
    ...over,
});

const figures = (over = {}) => ({
    companyId: CID_A,
    name: 'Acme',
    modes: { indexer: 'on', retrieval: 'on' },
    indexer: { mode: 'tenant', envKey: 'KNOWLEDGE_INDEXER' },
    staleAfterMs: 600000,
    sources: [
        source('page', { chunks: 12, sources: 4, textBytes: 2048, lastIndexedAt: WHEN }),
        source('file', { chunks: 3, sources: 1, backfill: { status: 'running', progress: { done: 2, total: 8 }, indexed: 2, skipped: 0 } }),
        source('memory', { chunks: 5, sources: 2, freshness: { heartbeatAt: WHEN, behindMs: 1200000, stale: true, catchUpFrom: null, catchUpBehindMs: null } }),
    ],
    totals: { chunks: 20, sources: 7, textBytes: 4096 },
    cachedAt: WHEN,
    embeddings: {
        model: 'text-embedding-3-small',
        configured: true,
        byModel: [{ model: 'text-embedding-3-small', chunks: 15, current: true }, { model: 'text-embedding-ada-002', chunks: 5, current: false }],
        pendingChunks: 5,
        breaker: { open: false, reason: null, until: null },
        spend: { month: '2026-09', usd: 0.25, calls: 3, tokens: 900 },
        budget: { usedUsd: 2.25, budgetUsd: 25 },
    },
    files: { reasons: [{ reason: 'extract:failed', count: 2, exhausted: 1, retryable: true }, { reason: 'skipped:too_large', count: 1, exhausted: 0, retryable: false }], pending: 1 },
    ...over,
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (status, code, statusText = 'Refused.') => Promise.reject({ response: { status, data: { status: false, statusText, code } } });

const EXCLUSION_ID = '6f0000000000000000000e01';
const exclusions = () => ({
    total: 1,
    exclusions: [{ id: EXCLUSION_ID, kind: 'document', sourceType: 'page', sourceId: PAGE, userId: '', erasedAt: WHEN, erasedBy: 'u1', erasedByName: 'Olivia Owner', erasedChunks: 2 }],
});

const serve = ({ summaryData = summary(), figuresData = figures(), exclusionsData = exclusions(), post = () => ok({}) } = {}) => {
    apiRequestWithoutCompnay.mockImplementation((type, url, body) => {
        const path = url.split('?')[0];
        if (type === 'get' && path === BASE) return ok(typeof summaryData === 'function' ? summaryData(url) : summaryData);
        if (type === 'get' && path.endsWith('/exclusions')) return ok(exclusionsData);
        if (type === 'get' && path.startsWith(`${BASE}/`)) return ok(typeof figuresData === 'function' ? figuresData(url) : figuresData);
        if (type === 'post') return post(url, body);
        return Promise.reject(new Error(`unexpected ${type} ${url}`));
    });
};

const mountWith = async (options) => {
    serve(options);
    const wrapper = mount(InstanceKnowledge);
    await flushPromises();
    return wrapper;
};

const opened = async (options) => {
    const wrapper = await mountWith(options);
    await wrapper.find(`[data-test="open-${CID_A}"]`).trigger('click');
    await flushPromises();
    return wrapper;
};

const posts = () => apiRequestWithoutCompnay.mock.calls.filter(([t]) => t === 'post');
const has = (wrapper, test) => wrapper.find(`[data-test="${test}"]`).exists();

/* Only the labels the screen translates when it has words for them; a source type or reason without any shows as it is. */
beforeAll(() => {
    const labels = ['reason_extract_failed', 'reason_skipped_too_large', 'source_page', 'source_file'];
    config.global.plugins[0].global.mergeLocaleMessage('en', { Knowledge: Object.fromEntries(labels.map((key) => [key, `Knowledge.${key}`])) });
});

describe('InstanceKnowledge', () => {
    let confirm;
    beforeEach(() => {
        apiRequestWithoutCompnay.mockReset();
        toast.success.mockReset();
        confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    });
    afterEach(() => { confirm.mockRestore(); });

    it('lists workspaces with their modes and source states, and reads figures only when one is opened', async () => {
        const wrapper = await mountWith();
        expect(has(wrapper, 'indexer-on')).toBe(true);
        expect(wrapper.find(`[data-test="modes-${CID_A}"]`).text()).toContain('Knowledge.mode_on');
        expect(wrapper.find(`[data-test="state-${CID_A}-file"]`).text()).toContain('Knowledge.backfill_running');
        expect(apiRequestWithoutCompnay.mock.calls.every(([, url]) => url.split('?')[0] === BASE)).toBe(true);
        expect(has(wrapper, `figures-${CID_A}`)).toBe(false);
    });

    it('shows the figures of an opened workspace: counts, size, progress, freshness, models and file reasons', async () => {
        const wrapper = await opened();
        const figuresCard = wrapper.find(`[data-test="figures-${CID_A}"]`);
        expect(figuresCard.find('[data-test="source-page"]').text()).toContain('12');
        expect(figuresCard.find('[data-test="source-page"]').text()).toContain('2.0 KB');
        expect(figuresCard.find('[data-test="backfill-file"]').text()).toContain('Knowledge.progress');
        expect(figuresCard.find('[data-test="freshness-memory"]').text()).toContain('Knowledge.stale');
        expect(figuresCard.find('[data-test="source-memory"]').text()).toContain('memory');
        expect(figuresCard.find('[data-test="model-text-embedding-ada-002"]').text()).toContain('5');
        expect(figuresCard.find('[data-test="pending-chunks"]').text()).toContain('Knowledge.pending_chunks');
        expect(figuresCard.find('[data-test="reason-extract:failed"]').text()).toContain('Knowledge.reason_extract_failed');
        expect(figuresCard.find('[data-test="reason-skipped:too_large"]').text()).toContain('Knowledge.reason_skipped_too_large');
    });

    it('with the indexer off, says so and offers erasure only', async () => {
        const off = { indexer: { mode: 'off', envKey: 'KNOWLEDGE_INDEXER' }, modes: { indexer: 'off', retrieval: 'hybrid' } };
        const wrapper = await opened({ summaryData: summary(off), figuresData: figures(off) });
        expect(wrapper.find('[data-test="indexer-off"]').text()).toContain('Knowledge.indexer_off');
        expect(wrapper.findAll('button').map((b) => b.attributes('data-test'))).not.toEqual(expect.arrayContaining([expect.stringMatching(/^(reindex|cancel-reindex|reembed|retry)/)]));
        expect(has(wrapper, 'erase-document')).toBe(true);
        expect(has(wrapper, 'erase-person')).toBe(true);
    });

    it('with the indexer off for the workspace alone, offers erasure only', async () => {
        const wrapper = await opened({ figuresData: figures({ modes: { indexer: 'off', retrieval: 'hybrid' } }) });
        expect(has(wrapper, 'reindex-page')).toBe(false);
        expect(has(wrapper, 'reembed')).toBe(false);
        expect(has(wrapper, 'retry-files')).toBe(false);
        expect(has(wrapper, 'erase-document')).toBe(true);
    });

    it('cancels a running re-index after a confirmation', async () => {
        const running = figures({ sources: [source('page', { reindex: { status: 'running', progress: { done: 1, total: 3 }, requestedAt: WHEN, finishedAt: null, failing: true } })] });
        const wrapper = await opened({ figuresData: running, post: () => ok({ sourceType: 'page' }) });
        expect(wrapper.find('[data-test="source-page"]').text()).toContain('Knowledge.reindex_failing');
        await wrapper.find('[data-test="cancel-reindex-page"]').trigger('click');
        await flushPromises();
        expect(confirm).toHaveBeenLastCalledWith('Knowledge.cancel_reindex_confirm');
        expect(posts()).toEqual([['post', `${BASE}/${CID_A}/reindex/cancel`, { sourceType: 'page' }]]);
    });

    it('says when the figures timed out, and reads them again on refresh', async () => {
        let calls = 0;
        serve();
        const wrapper = mount(InstanceKnowledge);
        await flushPromises();
        apiRequestWithoutCompnay.mockImplementation((type, url) => {
            if (type === 'get' && url.split('?')[0] === BASE) return ok(summary());
            if (url.endsWith('/exclusions')) return ok(exclusions());
            calls += 1;
            return calls === 1 ? refused(503, 'figures_timed_out') : ok(figures());
        });
        await wrapper.find(`[data-test="open-${CID_A}"]`).trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="figures-error"]').text()).toBe('Knowledge.code_figures_timed_out');
        await wrapper.find('[data-test="refresh-figures"]').trigger('click');
        await flushPromises();
        expect(apiRequestWithoutCompnay.mock.calls.map((c) => c[1])).toContain(`${BASE}/${CID_A}?refresh=1`);
        expect(has(wrapper, 'source-page')).toBe(true);
        expect(wrapper.find('[data-test="figures-cached"]').text()).toContain('Knowledge.cached_at');
    });

    it('says so when an erasure matched nothing', async () => {
        const wrapper = await opened({ post: () => ok({ removed: {}, total: 0 }) });
        await wrapper.find('[data-test="erase-id"]').setValue(PAGE);
        await wrapper.find('[data-test="erase-document"]').trigger('submit');
        await wrapper.find('[data-test="erase-confirm-input"]').setValue(PAGE);
        await wrapper.find('[data-test="erase-confirm-button"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="erase-nothing"]').text()).toBe('Knowledge.code_nothing_erased');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('re-indexes a source after a confirmation, and not when the confirmation is declined', async () => {
        const wrapper = await opened({ post: () => ok({ sourceType: 'page' }) });
        confirm.mockReturnValueOnce(false);
        await wrapper.find('[data-test="reindex-page"]').trigger('click');
        await flushPromises();
        expect(posts()).toEqual([]);

        await wrapper.find('[data-test="reindex-page"]').trigger('click');
        await flushPromises();
        expect(confirm).toHaveBeenLastCalledWith('Knowledge.reindex_confirm');
        expect(posts()).toEqual([['post', `${BASE}/${CID_A}/reindex`, { sourceType: 'page' }]]);
        expect(toast.success).toHaveBeenCalledWith('Knowledge.reindex_started');
    });

    it('offers re-index only for the source types the server can walk', async () => {
        const wrapper = await opened({ summaryData: summary({ reindexable: ['page'] }) });
        expect(has(wrapper, 'reindex-page')).toBe(true);
        expect(has(wrapper, 'reindex-file')).toBe(false);
        expect(has(wrapper, 'reindex-memory')).toBe(false);
    });

    it.each(['reindex_running', 'backfill_running', 'backfill_pending', 'workspace_indexer_off', 'indexer_off'])('translates the %s refusal', async (code) => {
        const wrapper = await opened({ post: () => refused(409, code) });
        await wrapper.find('[data-test="reindex-page"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="action-error"]').text()).toBe(`Knowledge.code_${code}`);
    });

    it('shows the server text for a code it does not know', async () => {
        const wrapper = await opened({ post: () => refused(500, 'brand_new', 'Something new went wrong.') });
        await wrapper.find('[data-test="reindex-page"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="action-error"]').text()).toBe('Something new went wrong.');
    });

    it('offers re-embed only in hybrid mode, after a confirmation', async () => {
        const plain = await opened();
        expect(has(plain, 'reembed')).toBe(false);

        const hybrid = { modes: { indexer: 'on', retrieval: 'hybrid' } };
        const wrapper = await opened({ figuresData: figures(hybrid), post: () => ok({ pendingChunks: 5 }) });
        await wrapper.find('[data-test="reembed"]').trigger('click');
        await flushPromises();
        expect(confirm).toHaveBeenLastCalledWith('Knowledge.reembed_confirm');
        expect(posts()).toEqual([['post', `${BASE}/${CID_A}/reembed`, {}]]);
    });

    it('retries failed files after a confirmation', async () => {
        const wrapper = await opened({ post: () => ok({ reset: 2, byReason: { 'extract:failed': 2 } }) });
        await wrapper.find('[data-test="retry-files"]').trigger('click');
        await flushPromises();
        expect(confirm).toHaveBeenLastCalledWith('Knowledge.retry_confirm');
        expect(posts()).toEqual([['post', `${BASE}/${CID_A}/retry-files`, {}]]);
        expect(toast.success).toHaveBeenCalledWith('Knowledge.retry_done');
    });

    it('hides retry when no file failed for a retryable reason', async () => {
        const wrapper = await opened({ figuresData: figures({ files: { reasons: [{ reason: 'skipped:too_large', count: 1, exhausted: 0, retryable: false }], pending: 0 } }) });
        expect(has(wrapper, 'retry-files')).toBe(false);
    });

    it('erases a document only once its id is typed back', async () => {
        const wrapper = await opened({ post: () => ok({ removed: { page: 2 }, total: 2 }) });
        await wrapper.find('[data-test="erase-type"]').setValue('page');
        await wrapper.find('[data-test="erase-id"]').setValue(PAGE);
        await wrapper.find('[data-test="erase-document"]').trigger('submit');
        await flushPromises();
        expect(posts()).toEqual([]);
        expect(wrapper.find('[data-test="erase-confirm"]').text()).toContain('Knowledge.erase_document_confirm');

        const button = wrapper.find('[data-test="erase-confirm-button"]');
        expect(button.attributes('disabled')).toBeDefined();
        await wrapper.find('[data-test="erase-confirm-input"]').setValue(PAGE.slice(0, -1));
        expect(button.attributes('disabled')).toBeDefined();
        await wrapper.find('[data-test="erase-confirm-input"]').setValue(PAGE);
        expect(button.attributes('disabled')).toBeUndefined();
        await button.trigger('click');
        await flushPromises();

        expect(posts()).toEqual([['post', `${BASE}/${CID_A}/erase/document`, { sourceType: 'page', sourceId: PAGE, confirm: PAGE }]]);
        expect(toast.success).toHaveBeenCalledWith('Knowledge.erased');
        expect(has(wrapper, 'erase-confirm')).toBe(false);
    });

    it("erases a person only once the person's id is typed back, in either case", async () => {
        const wrapper = await opened({ post: () => ok({ removed: { page: 1 }, total: 1 }) });
        await wrapper.find('[data-test="erase-user"]').setValue(ALICE.toUpperCase());
        await wrapper.find('[data-test="erase-person"]').trigger('submit');
        await flushPromises();
        expect(wrapper.find('[data-test="erase-confirm"]').text()).toContain('Knowledge.erase_person_confirm');
        await wrapper.find('[data-test="erase-confirm-input"]').setValue('Acme');
        expect(wrapper.find('[data-test="erase-confirm-button"]').attributes('disabled')).toBeDefined();
        await wrapper.find('[data-test="erase-confirm-input"]').setValue(ALICE);
        await wrapper.find('[data-test="erase-confirm-button"]').trigger('click');
        await flushPromises();
        expect(posts()).toEqual([['post', `${BASE}/${CID_A}/erase/person`, { userId: ALICE, confirm: ALICE }]]);
    });

    it('refuses to ask for an erasure of an id that is not an id', async () => {
        const wrapper = await opened();
        await wrapper.find('[data-test="erase-user"]').setValue('someone');
        await wrapper.find('[data-test="erase-person"]').trigger('submit');
        await flushPromises();
        expect(has(wrapper, 'erase-confirm')).toBe(false);
        expect(wrapper.find('[data-test="erase-input-error"]').text()).toBe('Knowledge.code_invalid_user_id');
    });

    it('translates an erasure refusal', async () => {
        const wrapper = await opened({ post: () => refused(400, 'confirmation_mismatch') });
        await wrapper.find('[data-test="erase-user"]').setValue(ALICE);
        await wrapper.find('[data-test="erase-person"]').trigger('submit');
        await wrapper.find('[data-test="erase-confirm-input"]').setValue(ALICE);
        await wrapper.find('[data-test="erase-confirm-button"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="action-error"]').text()).toBe('Knowledge.code_confirmation_mismatch');
    });

    it('lists the exclusions of an opened workspace: ids, kind, when, who and chunks kept out', async () => {
        const wrapper = await opened();
        const row = wrapper.find(`[data-test="exclusion-${EXCLUSION_ID}"]`);
        expect(row.text()).toContain(PAGE);
        expect(row.text()).toContain('Olivia Owner');
        expect(row.text()).toContain('2');
        expect(row.text()).toContain('Knowledge.exclusion_kind_document');
    });

    it('removes an exclusion only once its id is typed back', async () => {
        const wrapper = await opened({ post: () => ok({ removed: true }) });
        await wrapper.find(`[data-test="remove-exclusion-${EXCLUSION_ID}"]`).trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="erase-confirm"]').text()).toContain('Knowledge.exclusion_remove_confirm');
        await wrapper.find('[data-test="erase-confirm-input"]').setValue('nope');
        expect(wrapper.find('[data-test="erase-confirm-button"]').attributes('disabled')).toBeDefined();
        await wrapper.find('[data-test="erase-confirm-input"]').setValue(PAGE);
        await wrapper.find('[data-test="erase-confirm-button"]').trigger('click');
        await flushPromises();
        expect(posts()).toEqual([['post', `${BASE}/${CID_A}/exclusions/${EXCLUSION_ID}/remove`, { confirm: PAGE }]]);
        expect(toast.success).toHaveBeenCalledWith('Knowledge.exclusion_removed');
    });

    it('says when there are no exclusions', async () => {
        const wrapper = await opened({ exclusionsData: { total: 0, exclusions: [] } });
        expect(wrapper.find('[data-test="no-exclusions"]').text()).toBe('Knowledge.no_exclusions');
    });

    it('translates not_found for an erasure of something that is not there', async () => {
        const wrapper = await opened({ post: () => refused(404, 'not_found') });
        await wrapper.find('[data-test="erase-id"]').setValue(PAGE);
        await wrapper.find('[data-test="erase-document"]').trigger('submit');
        await wrapper.find('[data-test="erase-confirm-input"]').setValue(PAGE);
        await wrapper.find('[data-test="erase-confirm-button"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="action-error"]').text()).toBe('Knowledge.code_not_found');
    });

    describe('paging', () => {
        const paged = (url) => {
            const page = Number(new URLSearchParams(url.split('?')[1] || '').get('page')) || 1;
            return summary({ page, pageSize: 1, total: 3, workspaces: [row(`6f00000000000000000000c${page}`, `W${page}`)] });
        };

        it('moves between pages and disables the ends', async () => {
            const wrapper = await mountWith({ summaryData: paged });
            expect(wrapper.find('[data-test="page-status"]').text()).toBe('Knowledge.page_status');
            expect(wrapper.find('[data-test="page-prev"]').attributes('disabled')).toBeDefined();
            await wrapper.find('[data-test="page-next"]').trigger('click');
            await flushPromises();
            expect(apiRequestWithoutCompnay.mock.calls.at(-1)[1]).toBe(`${BASE}?page=2`);
            expect(has(wrapper, 'workspace-6f00000000000000000000c2')).toBe(true);
        });

        it('shows no pager on a single page', async () => {
            const wrapper = await mountWith();
            expect(has(wrapper, 'pager')).toBe(false);
        });
    });
});
