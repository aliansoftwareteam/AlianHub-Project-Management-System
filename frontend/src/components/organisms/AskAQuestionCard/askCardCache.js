/* A dashboard is shared, and an Ask answer is built from what its asker can open, so an answer is kept
 * only for the viewer who asked it: the viewer's id is part of every key. It lives in memory, so a
 * reload or a sign-out asks again. */
export const ASK_ANSWER_TTL_MS = 30 * 60 * 1000;

const answers = new Map();

const keyOf = ({ companyId, userId, question, projectId }) => JSON.stringify([String(companyId || ''), String(userId || ''), String(projectId || ''), String(question || '')]);

export function recallAskAnswer(key, now = Date.now()) {
    if (!key.userId) return null;
    const hit = answers.get(keyOf(key));
    if (!hit || now - hit.askedAt > ASK_ANSWER_TTL_MS) return null;
    return hit;
}

export function rememberAskAnswer(key, answer, now = Date.now()) {
    if (!key.userId) return { ...answer, askedAt: now };
    const kept = { ...answer, askedAt: now };
    answers.set(keyOf(key), kept);
    return kept;
}

export function forgetAskAnswers() {
    answers.clear();
}
