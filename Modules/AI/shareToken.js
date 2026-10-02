'use strict';

const crypto = require('crypto');

/* An answer given to one person can later be posted as it was given, by that person: the token signs the asker, the
 * place it was asked in, the question, the answer, what it cites and every source it was built from, so posting needs
 * no stored copy and no second model call, and nothing in it can be changed on the way. */

const SHARE_TTL_MS = 30 * 60 * 1000;

/* An Ask answer belongs to no conversation, so its token names this place: a token made in a conversation is not one. */
const ASK_ANSWER = Object.freeze({ projectId: 'ask', sprintId: '', taskId: '' });

const citedKey = (cited) => (Array.isArray(cited) ? cited : [])
    .map((c) => [String((c && c.kind) || ''), String((c && c.id) || ''), String((c && c.ref) || ''), String((c && c.projectId) || '')]);

const signatureOf = ({ companyId, uid, thread, question, answer, cited, used, issuedAt }) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set.');
    const payload = JSON.stringify([companyId, uid, thread.projectId, thread.sprintId, thread.taskId, question, answer, citedKey(cited), used, issuedAt]);
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
};

const shareTokenFor = (fields) => `${fields.issuedAt}.${Buffer.from(JSON.stringify(fields.used || [])).toString('base64url')}.${signatureOf(fields)}`;

/* The sources the answer was built from, or null when the token is not this answer's. */
const sharedSourcesOf = (token, fields, now = Date.now()) => {
    const [issued, packed, signature] = String(token || '').split('.');
    const issuedAt = Number(issued);
    if (!Number.isFinite(issuedAt) || !packed || !signature || now - issuedAt > SHARE_TTL_MS || issuedAt > now + 60 * 1000) return null;
    let used;
    try {
        used = JSON.parse(Buffer.from(packed, 'base64url').toString('utf8'));
    } catch (error) {
        return null;
    }
    if (!Array.isArray(used)) return null;
    const expected = Buffer.from(signatureOf({ ...fields, used, issuedAt }), 'hex');
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? used : null;
};

/* The token of an Ask answer, or '' where there is no secret to sign with: the answer is still given, and cannot be posted. */
const askAnswerToken = ({ companyId, uid, question, answer, cited, sources }) => {
    if (!answer || !process.env.JWT_SECRET) return '';
    return shareTokenFor({
        companyId: String(companyId),
        uid: String(uid),
        thread: ASK_ANSWER,
        question: String(question || '').trim(),
        answer,
        cited,
        used: (sources || []).map((s) => [String(s.kind), String(s.id)]),
        issuedAt: Date.now(),
    });
};

module.exports = { SHARE_TTL_MS, ASK_ANSWER, citedKey, shareTokenFor, sharedSourcesOf, askAnswerToken };
