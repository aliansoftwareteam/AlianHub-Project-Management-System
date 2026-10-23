const http = require('node:http');
const answers = require('./websiteRelaunchPlan');

/* A stand-in OpenAI-compatible endpoint for the demo recording: the server is pointed at it as its
 * "openai_compatible" provider, and each chat call is answered from websiteRelaunchPlan.js by the
 * prompt it carries. No model and no key is involved; an unknown prompt gets an empty object, which
 * the caller treats as a failed AI step. */

const MODEL = 'scripted-demo';

const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
});

function reply(messages, state) {
    const system = String((messages.find((m) => m.role === 'system') || {}).content || '');
    const user = messages.filter((m) => m.role === 'user').map((m) => String(m.content || '')).join('\n');
    if (system.includes('Brief completeness reviewer')) return user.includes('Is the content moving over') ? answers.COVERAGE_MET : answers.COVERAGE_OPEN;
    if (system.includes('Senior product consultant')) return answers.QUESTIONS;
    if (system.includes('Brief writer')) return answers.BRIEF;
    if (system.includes('Project guide author')) return answers.GUIDE;
    if (system.includes('A complete project plan')) return answers.plan(state.memberIds);
    state.unknown.push(system.slice(0, 80).replace(/\s+/g, ' '));
    return {};
}

function startScriptedModel({ delayMs = 0 } = {}) {
    const state = { memberIds: [], unknown: [], calls: 0 };
    const server = http.createServer(async (req, res) => {
        const send = (status, body) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) return send(404, { error: { message: 'not found' } });
        let body;
        try {
            body = JSON.parse(await readBody(req));
        } catch (error) {
            return send(400, { error: { message: 'bad json' } });
        }
        state.calls += 1;
        const content = JSON.stringify(reply(body.messages || [], state));
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const tokens = Math.ceil(content.length / 4);
        return send(200, {
            id: `demo-${state.calls}`, object: 'chat.completion', model: MODEL,
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1200, completion_tokens: tokens, total_tokens: 1200 + tokens },
        });
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                state,
                env: { LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${port}/v1`, OPENAI_COMPATIBLE_MODEL: MODEL },
                stop: () => new Promise((done) => server.close(() => done())),
            });
        });
    });
}

module.exports = { startScriptedModel, MODEL };
