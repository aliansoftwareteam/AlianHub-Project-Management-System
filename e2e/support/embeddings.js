const crypto = require('node:crypto');
const http = require('node:http');

/* A stand-in for the OpenAI embeddings endpoint, so a hybrid company in the harness embeds
 * without a key or a network. Each text becomes a fixed-size vector from a hash of its words,
 * so two texts that share words score close and nothing is remembered between requests. It
 * insists on a bearer token, as the real endpoint does, so a missing key still fails. */

const DIMENSIONS = 64;

function vectorOf(text) {
    const vector = new Array(DIMENSIONS).fill(0);
    const words = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    for (const word of words) {
        const digest = crypto.createHash('sha256').update(word).digest();
        const at = digest[0] % DIMENSIONS;
        vector[at] += digest[1] % 2 ? 1 : -1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function answer(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

async function handle(req, res) {
    if (req.method !== 'POST' || req.url !== '/v1/embeddings') return answer(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } });
    if (!/^Bearer \S+$/.test(req.headers.authorization || '')) return answer(res, 401, { error: { message: 'no api key', type: 'invalid_request_error', code: 'invalid_api_key' } });
    let body;
    try {
        body = JSON.parse(await readBody(req));
    } catch (error) {
        return answer(res, 400, { error: { message: 'bad json', type: 'invalid_request_error' } });
    }
    const input = Array.isArray(body.input) ? body.input : [body.input];
    const tokens = input.reduce((sum, text) => sum + Math.max(1, Math.ceil(String(text || '').length / 4)), 0);
    return answer(res, 200, {
        object: 'list',
        data: input.map((text, index) => ({ object: 'embedding', index, embedding: vectorOf(text) })),
        model: body.model,
        usage: { prompt_tokens: tokens, total_tokens: tokens },
    });
}

function startEmbeddingsStub() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => { handle(req, res).catch((error) => answer(res, 500, { error: { message: error.message, type: 'server_error' } })); });
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}/v1/embeddings`,
                stop: () => new Promise((done) => server.close(() => done())),
            });
        });
    });
}

module.exports = { DIMENSIONS, vectorOf, startEmbeddingsStub };
