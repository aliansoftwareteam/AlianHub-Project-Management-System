'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../Config/loggerConfig');

let providerFactory = null;
try {
    providerFactory = require('../AIProjectGenerator/llmProvider');
} catch (_e) {
    providerFactory = null;
}

const REQUEST_TIMEOUT_MS = 120_000;
const TRANSCRIPT_CHAR_CAP = 60_000;
const MAX_ACTION_ITEMS = 12;

const SYSTEM_PROMPT = (() => {
    const promptPath = path.join(__dirname, 'prompts', 'meeting-notes.md');
    return fs.readFileSync(promptPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
})();

const clamp = (value, cap) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length <= cap ? text : `${text.slice(0, cap)}…`;
};

function parseNotes(raw) {
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (_e) {
        const match = String(raw || '').match(/\{[\s\S]*\}/);
        if (!match) return null;
        try { parsed = JSON.parse(match[0]); } catch (_err) { return null; }
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const items = Array.isArray(parsed.actionItems) ? parsed.actionItems : [];
    const actionItems = items
        .filter((item) => item && typeof item.title === 'string' && item.title.trim())
        .slice(0, MAX_ACTION_ITEMS)
        .map((item, index) => ({
            id: `ai_${index + 1}`,
            title: clamp(item.title, 200),
            owner: clamp(item.owner, 80),
            due: clamp(item.due, 40),
            at: clamp(item.at, 12),
            done: false,
            taskId: '',
            taskUrl: '',
        }));

    return {
        summary: clamp(parsed.summary, 4000),
        actionItems,
    };
}

function isConfigured() {
    return !!(providerFactory
        && typeof providerFactory.isAnyProviderConfigured === 'function'
        && providerFactory.isAnyProviderConfigured());
}

/**
 * @param {{ transcript: string, title?: string, participants?: string[], kind?: 'call'|'chat' }} input
 * @returns {Promise<{status:boolean, data?:{summary:string, actionItems:object[]}, reason?:string}>}
 */
async function generateMeetingNotes(input = {}) {
    const transcript = clamp(input.transcript, TRANSCRIPT_CHAR_CAP);
    if (!transcript) return { status: false, reason: 'Nothing to summarise.' };
    if (!isConfigured()) return { status: false, reason: 'No AI provider is configured.' };

    let provider;
    try {
        provider = providerFactory.getProvider();
    } catch (error) {
        return { status: false, reason: error.message };
    }

    const participants = Array.isArray(input.participants) ? input.participants.filter(Boolean).slice(0, 30) : [];
    const userMessage = [
        `Source: ${input.kind === 'chat' ? 'chat thread' : 'call transcript'}`,
        input.title ? `Title: ${clamp(input.title, 200)}` : '',
        participants.length ? `Participants: ${participants.join(', ')}` : '',
        '',
        'TRANSCRIPT:',
        transcript,
    ].filter((line, index) => line !== '' || index > 2).join('\n');

    try {
        const result = await Promise.race([
            provider.chat({
                systemPrompt: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: userMessage }],
                jsonMode: true,
                temperature: 0.2,
                maxTokens: 4096,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Meeting notes request timed out')), REQUEST_TIMEOUT_MS)),
        ]);
        const parsed = result && typeof result.content === 'string' ? parseNotes(result.content) : null;
        if (!parsed) return { status: false, reason: 'The AI returned nothing usable.' };
        return { status: true, data: parsed };
    } catch (error) {
        logger.error(`meetingNotes: ${error && error.message ? error.message : error}`);
        return { status: false, reason: (error && error.message) || 'Meeting notes failed.' };
    }
}

/** POST /api/v1/ai/meeting-notes  { transcript, title?, participants?, kind? } */
async function meetingNotesHandler(req, res) {
    try {
        if (!req.headers['companyid']) {
            return res.status(400).send({ status: false, statusText: 'companyId header required' });
        }
        const result = await generateMeetingNotes(req.body || {});
        if (!result.status) return res.send({ status: false, statusText: result.reason });
        return res.send({ status: true, data: result.data });
    } catch (error) {
        logger.error(`meetingNotesHandler: ${error && error.message ? error.message : error}`);
        return res.send({ status: false, statusText: (error && error.message) || 'Meeting notes failed.' });
    }
}

module.exports = { generateMeetingNotes, meetingNotesHandler, isConfigured, parseNotes };
