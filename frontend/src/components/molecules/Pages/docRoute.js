const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function docRoute(cid, pageId, query) {
    return { name: 'PageEditor', params: { cid, pageId: String(pageId) }, ...(query ? { query } : {}) };
}

/* The Docs hub never opened the doc named by ?page=, but the command palette used to link
 * to that address and copy it, so one that arrives is sent on to the doc. */
export function hubLinkToDoc(to) {
    const { page, ...rest } = to.query || {};
    if (typeof page !== 'string' || !OBJECT_ID.test(page)) return true;
    return docRoute(to.params.cid, page, Object.keys(rest).length ? rest : undefined);
}
