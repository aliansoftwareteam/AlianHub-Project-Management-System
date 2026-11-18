const http = require('node:http');

/* A loopback stand-in for a self-hosted OpenAI-compatible server (Ollama, vLLM, LM Studio).
 * It records every request so a test can assert that none was made, and `behave` swaps in a
 * failure: a status, a stall, a redirect or vectors of the wrong size. */

const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
});

const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
};

function startOpenAiCompatibleServer({ prefix = '/v1', models = ['llama3.1:8b', 'nomic-embed-text'], dimensions = 4, apiKey = null } = {}) {
    const requests = [];
    const state = { mode: null, dimensions };

    const handle = async (req, res) => {
        const raw = await readBody(req);
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = raw; }
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (state.mode === 'stall') return undefined;
        if (state.mode === 'redirect') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
        if (typeof state.mode === 'number') return send(res, state.mode, { error: { message: `stub says ${state.mode}`, type: 'server_error' } });
        if (apiKey && req.headers.authorization !== `Bearer ${apiKey}`) return send(res, 401, { error: { message: 'bad key', type: 'invalid_request_error', code: 'invalid_api_key' } });
        if (req.method === 'GET' && req.url === `${prefix}/models`) {
            return send(res, 200, { object: 'list', data: models.map((id) => ({ id, object: 'model', owned_by: 'library' })) });
        }
        if (req.method === 'POST' && req.url === `${prefix}/chat/completions`) {
            const last = (body.messages || []).filter((m) => m.role === 'user').pop();
            return send(res, 200, {
                id: 'chatcmpl-stub',
                object: 'chat.completion',
                model: body.model,
                choices: [{ index: 0, message: { role: 'assistant', content: `echo: ${last ? last.content : ''}` }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
            });
        }
        if (req.method === 'POST' && req.url === `${prefix}/audio/transcriptions`) {
            return send(res, 200, { text: 'hello from audio' });
        }
        if (req.method === 'POST' && req.url === `${prefix}/embeddings`) {
            const input = Array.isArray(body.input) ? body.input : [body.input];
            const sizeOf = (index) => (state.mode === 'ragged' && index === 1 ? state.dimensions + 1 : state.dimensions);
            return send(res, 200, {
                object: 'list',
                model: body.model,
                data: input.map((text, index) => ({ object: 'embedding', index, embedding: Array.from({ length: sizeOf(index) }, (_, i) => (String(text).length + i) / 10) })),
                usage: { prompt_tokens: input.length * 2, total_tokens: input.length * 2 },
            });
        }
        return send(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } });
    };

    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => { handle(req, res).catch((error) => send(res, 500, { error: { message: error.message } })); });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                port,
                baseUrl: `http://127.0.0.1:${port}${prefix}`,
                requests,
                behave: (mode) => { state.mode = mode; },
                resize: (size) => { state.dimensions = size; },
                reset: () => { requests.length = 0; state.mode = null; state.dimensions = dimensions; },
                stop: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
            });
        });
    });
}

module.exports = { startOpenAiCompatibleServer };
