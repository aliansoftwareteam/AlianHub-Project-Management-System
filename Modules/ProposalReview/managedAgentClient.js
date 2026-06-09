/**
 * Thin client for the Upwork-bid-reviewer Managed Agent on platform.claude.com.
 *
 * Single responsibility: given a job + the task's recent comment thread, ask
 * the agent for a verdict and return its raw JSON output as
 *   { found: boolean, verdict?: "APPROVE"|"BACKLOG"|null, reason?: string }.
 *
 * Connection only — does NOT move statuses, post comments, or know about
 * Mongo/Postgres. Whatever wraps this layer wires it into the wider workflow.
 *
 * Self-contained: does NOT touch Modules/AIProjectGenerator/llmProvider/, so
 * the existing OpenAI/Anthropic/DeepSeek selection for the AI project
 * generator is unaffected. Uses its own env vars:
 *   - ANTHROPIC_API_KEY         (must belong to the workspace that owns the agent)
 *   - PROPOSAL_REVIEW_AGENT_ID  (the platform.claude.com agent id, e.g. agent_01J...)
 *   - PROPOSAL_REVIEW_ENV_ID    (the Managed Agent environment id, e.g. env_01L...)
 *
 * The agent's system prompt, judgment rules, output schema, and per-category
 * skill checklist are all configured on platform.claude.com — this client
 * sends ONLY the per-call data (job + thread) and returns the parsed verdict.
 */
'use strict';

let AnthropicSdk;
try {
    AnthropicSdk = require('@anthropic-ai/sdk');
} catch (_e) {
    AnthropicSdk = null;
}

const logger = require('../../Config/loggerConfig');

const MAX_JOB_DESCRIPTION_CHARS = 3000;
const MAX_COMMENT_CHARS = 2500;
const MAX_COMMENTS = 8;

function isConfigured() {
    return Boolean(
        AnthropicSdk
        && process.env.ANTHROPIC_API_KEY
        && process.env.PROPOSAL_REVIEW_AGENT_ID
        && process.env.PROPOSAL_REVIEW_ENV_ID,
    );
}

function getClient() {
    const Anthropic = AnthropicSdk.default || AnthropicSdk.Anthropic || AnthropicSdk;
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function buildUserMessage(job, thread) {
    const title = (job && job.title) || '';
    const description = String((job && job.description) || '').slice(0, MAX_JOB_DESCRIPTION_CHARS);
    const questions = (job && job.questions) || [];
    const comments = Array.isArray(thread) ? thread.slice(-MAX_COMMENTS) : [];
    const threadText = comments
        .map((c, i) => {
            const text = String((c && c.text) || '').slice(0, MAX_COMMENT_CHARS);
            const user = (c && c.userId) || 'unknown';
            return `--- Comment ${i + 1} (user ${user}) ---\n${text}`;
        })
        .join('\n\n');
    return [
        `JOB TITLE: ${title}`,
        '',
        'JOB DESCRIPTION:',
        description,
        '',
        `SCREENING QUESTIONS: ${JSON.stringify(questions)}`,
        '',
        'COMMENT THREAD (oldest first):',
        threadText || '(no comments)',
    ].join('\n');
}

function parseVerdict(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_e) { return { found: false, raw: text, parseError: true }; }
    if (parsed && parsed.found === false) return { found: false };
    const v = String((parsed && parsed.verdict) || '').toUpperCase();
    return {
        found: parsed.found === true,
        verdict: v === 'APPROVE' ? 'APPROVE' : (v === 'BACKLOG' ? 'BACKLOG' : null),
        reason: (parsed && parsed.reason) || '',
    };
}

/**
 * Send one (job, thread) pair to the Managed Agent and return its verdict.
 *
 * @param {Object} input
 * @param {{ title: string, description: string, questions?: any }} input.job
 * @param {Array<{ userId?: string, text: string }>} input.thread  Oldest first.
 * @returns {Promise<{
 *   found: boolean,
 *   verdict?: 'APPROVE'|'BACKLOG'|null,
 *   reason?: string,
 *   raw?: string,
 *   parseError?: boolean
 * }>}
 */
async function reviewProposal({ job, thread }) {
    if (!isConfigured()) {
        throw new Error(
            'ProposalReview Managed Agent client not configured: install @anthropic-ai/sdk '
            + 'and set ANTHROPIC_API_KEY + PROPOSAL_REVIEW_AGENT_ID + PROPOSAL_REVIEW_ENV_ID',
        );
    }
    const client = getClient();
    const agentId = process.env.PROPOSAL_REVIEW_AGENT_ID;
    const envId = process.env.PROPOSAL_REVIEW_ENV_ID;
    const userText = buildUserMessage(job, thread);

    try {
        const session = await client.beta.sessions.create({ agent: agentId, environment_id: envId });
        const sessionId = session && (session.id || session.session_id);
        if (!sessionId) throw new Error('Managed Agent: session.create returned no id');

        // Open the event stream BEFORE sending the user message so we never miss
        // the agent.message event on a fast-responding session.
        const stream = await client.beta.sessions.events.stream(sessionId);

        await client.beta.sessions.events.send(sessionId, {
            events: [{ type: 'user.message', content: [{ type: 'text', text: userText }] }],
        });

        let assistantText = '';
        for await (const evt of stream) {
            if (!evt || typeof evt !== 'object') continue;
            if (evt.type === 'agent.message' && Array.isArray(evt.content)) {
                for (const block of evt.content) {
                    if (block && block.type === 'text' && typeof block.text === 'string') {
                        assistantText += block.text;
                    }
                }
            } else if (evt.type === 'session.status_idle') {
                const reason = evt.stop_reason && evt.stop_reason.type;
                if (reason === 'retries_exhausted') throw new Error('Managed Agent: retries exhausted');
                if (reason === 'requires_action') throw new Error('Managed Agent: requires user action (unexpected for this no-tool reviewer agent)');
                // end_turn (or any other idle reason) → the agent finished its turn.
                break;
            } else if (evt.type === 'session.error') {
                const msg = (evt.error && (evt.error.message || evt.error.type)) || 'unknown error';
                throw new Error(`Managed Agent error: ${msg}`);
            }
        }

        return parseVerdict(assistantText);
    } catch (err) {
        const status = err && err.status;
        if (status === 401 || status === 403) {
            const e = new Error('Managed Agent: invalid or unauthorized ANTHROPIC_API_KEY for this workspace');
            e.code = 'MA_AUTH_FAILED';
            throw e;
        }
        if (status === 404) {
            const e = new Error(`Managed Agent: agent "${agentId}" not found (check PROPOSAL_REVIEW_AGENT_ID and workspace)`);
            e.code = 'MA_NOT_FOUND';
            throw e;
        }
        if (status === 429) {
            const e = new Error('Managed Agent: rate-limited or out of credits (HTTP 429)');
            e.code = 'MA_RATE_LIMITED';
            throw e;
        }
        logger.error(`ProposalReview managedAgentClient error: ${err && err.message ? err.message : err}`);
        throw err;
    }
}

module.exports = {
    isConfigured,
    reviewProposal,
    buildUserMessage,
    parseVerdict,
};
