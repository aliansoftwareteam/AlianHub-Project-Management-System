import { describe, expect, it } from 'vitest';
import { docRoute } from '@/components/molecules/Pages/docRoute';
import pagesRoutes from '@/router/pages';
import { recentRoute } from '@/components/molecules/Home/recentItems';
import { sourceLink } from '@/views/Ai/askWhy';

const DOC = '6f0000000000000000000e01';
const hub = pagesRoutes.find((route) => route.name === 'Pages');
const arriving = (query) => hub.beforeEnter({ name: 'Pages', params: { cid: 'c1' }, query });

describe('the route to a doc', () => {
    it('is the doc editor, with the id as a string', () => {
        expect(docRoute('c1', DOC)).toEqual({ name: 'PageEditor', params: { cid: 'c1', pageId: DOC } });
        expect(docRoute('c1', { toString: () => DOC }).params.pageId).toBe(DOC);
    });

    it('carries a query only when one is given', () => {
        expect(docRoute('c1', DOC, { comment: 'k1' })).toEqual({ name: 'PageEditor', params: { cid: 'c1', pageId: DOC }, query: { comment: 'k1' } });
        expect(docRoute('c1', DOC)).not.toHaveProperty('query');
    });

    it('is the one Home recents and Ask sources use', () => {
        expect(recentRoute({ type: 'doc', id: DOC }, 'c1')).toEqual(docRoute('c1', DOC));
        expect(sourceLink({ kind: 'page', id: DOC }, 'c1')).toEqual(docRoute('c1', DOC));
    });
});

describe('a Docs hub link that names a doc', () => {
    it('opens the doc, so links copied from the palette before the fix still work', () => {
        expect(arriving({ page: DOC })).toEqual({ name: 'PageEditor', params: { cid: 'c1', pageId: DOC } });
    });

    it('keeps the rest of the query', () => {
        expect(arriving({ page: DOC, comment: 'k1' })).toEqual({ name: 'PageEditor', params: { cid: 'c1', pageId: DOC }, query: { comment: 'k1' } });
    });

    it('stays on the hub without a doc id, or with one that is not an id', () => {
        expect(arriving({})).toBe(true);
        expect(arriving({ page: 'trash' })).toBe(true);
        expect(arriving({ page: [DOC, DOC] })).toBe(true);
    });
});
