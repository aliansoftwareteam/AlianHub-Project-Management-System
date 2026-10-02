const refusalOf = (source, fallback) => source?.response?.data?.statusText || source?.data?.statusText || source?.message || fallback;

/* A change that was carried out in part (a project setup) names what it could not make; each counts as one thing not done. */
const notMadeIn = (change) => (Array.isArray(change?.result?.notMade) ? change.result.notMade : [])
    .filter((entry) => entry && typeof entry.error === 'string')
    .map((entry) => ({ ok: false, error: typeof entry.name === 'string' && entry.name ? `${entry.name}: ${entry.error}` : entry.error }));

export const unappliedOf = (data) => (Array.isArray(data?.applied) ? data.applied : [])
    .flatMap((change) => (change && change.ok === false ? [change] : notMadeIn(change)));

/* Why each part of an undo stayed as it was, in the server's words. */
const leftOf = (data) => (Array.isArray(data?.results) ? data.results : []).filter((part) => part && part.ok === false).map((part) => part.message || part.reason || '').filter(Boolean);

/* One decision through the agent API. A refusal is an answer, never a throw, so a caller working through several keeps going. */
export const decideOne = async (send, id, verb, body, fallback) => {
    try {
        const res = await send(id, verb, body);
        if (!res?.data?.status) return { id, ok: false, error: refusalOf(res, fallback) };
        const data = res.data.data || {};
        return { id, ok: true, undo: Boolean(data.undoUntil), unapplied: unappliedOf(data), left: leftOf(data), standing: data.standing || null };
    } catch (error) {
        return { id, ok: false, error: refusalOf(error, fallback) };
    }
};

/* In turn, not at once: each approval is the single-approve call, and the server claims one proposal at a time. */
export const decideEach = async (ids, decide, onResult = () => {}) => {
    const results = [];
    for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        const result = await decide(id);
        results.push(result);
        onResult(result);
    }
    return results;
};
