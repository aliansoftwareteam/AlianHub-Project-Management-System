// Talk to Text — speech-to-text through the OpenAI transcription API.
// POST /api/v1/ai/transcribe  (multipart/form-data, field name: "file")
//   → { status: true, data: { text } }
// Audio goes where chat goes: the instance's OpenAI-compatible server when it
// answers chat (so a self-hosted instance uploads nothing to OpenAI), otherwise
// OpenAI at OPENAI_BASE_URL with config.OPENAI_API_KEY or config.AI_API_KEY.
const multer = require('multer');
const config = require('../../Config/config');
const logger = require('../../Config/loggerConfig');
const aiSwitch = require('../AICore/aiSwitch');
const { apiKeyFor } = require('../AICore/providerKeys');
const compatibleClient = require('../AICore/llmProvider/compatibleClient');
const { embeddingProviderName } = require('../AICore/llmProvider/embeddingChoice');
const openaiProvider = require('../AICore/llmProvider/openaiProvider');

const TRANSCRIBE_TIMEOUT_MS = 120000;

// Whisper's hard limit is 25 MB; keep the (short) dictation in memory.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } });

// Wrap multer so its errors become the { status, statusText } shape the
// frontend already understands (instead of a bare 500).
function uploadMiddleware(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ status: false, statusText: 'Recording is too large (max 25 MB).' });
            }
            return res.status(400).json({ status: false, statusText: err.message || 'Audio upload failed.' });
        }
        return res.status(400).json({ status: false, statusText: (err && err.message) || 'Audio upload failed.' });
    });
}

const formFor = (req, model) => {
    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    form.append('file', blob, req.file.originalname || 'audio.webm');
    form.append('model', model);
    form.append('response_format', 'json');
    // Optional caller hint: a 2-letter language code improves accuracy.
    if (req.body && req.body.language) form.append('language', String(req.body.language));
    return form;
};

const NOT_CONFIGURED = { status: 503, body: { status: false, statusText: 'Speech-to-text is not configured.' } };

const configured = (compatible) => (compatible
    ? !!String(process.env.OPENAI_COMPATIBLE_BASE_URL || '').trim()
    : !!(config.OPENAI_API_KEY || config.AI_API_KEY));

async function viaCompatible(req, model) {
    const baseUrl = String(process.env.OPENAI_COMPATIBLE_BASE_URL || '').trim();
    try {
        const response = await compatibleClient.request({ baseUrl, path: '/audio/transcriptions', body: formFor(req, model), apiKey: await apiKeyFor('openai_compatible'), timeoutMs: TRANSCRIBE_TIMEOUT_MS });
        const text = response.data && typeof response.data.text === 'string' ? response.data.text.trim() : '';
        return { status: 200, body: { status: true, data: { text } } };
    } catch (error) {
        const status = error.response && error.response.status;
        logger.error(`transcribe: compatible endpoint ${status || ''} ${compatibleClient.describeFailure(error)}`);
        return { status: 502, body: { status: false, statusText: `Transcription failed (${status || 'unreachable'}).` } };
    }
}

async function viaOpenAi(req, model) {
    const apiKey = config.OPENAI_API_KEY || config.AI_API_KEY;
    const response = await fetch(`${openaiProvider.baseUrl()}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formFor(req, model),
    });
    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        logger.error(`transcribe: Whisper ${response.status}: ${errText}`);
        return { status: 502, body: { status: false, statusText: `Transcription failed (${response.status}).` } };
    }
    const data = await response.json().catch(() => ({}));
    const text = data && typeof data.text === 'string' ? data.text.trim() : '';
    return { status: 200, body: { status: true, data: { text } } };
}

exports.transcribe = [
    uploadMiddleware,
    async (req, res) => {
        try {
            try {
                await aiSwitch.assertAllowed(req.headers && req.headers.companyid);
            } catch (error) {
                if (!aiSwitch.isAiOff(error)) throw error;
                return res.status(403).json({ status: false, code: aiSwitch.AI_OFF, statusText: error.message });
            }
            const compatible = embeddingProviderName() === 'openai_compatible';
            if (!configured(compatible)) return res.status(NOT_CONFIGURED.status).json(NOT_CONFIGURED.body);
            if (!req.file || !req.file.buffer || !req.file.buffer.length) {
                return res.status(400).json({ status: false, statusText: 'No audio received (field name: file).' });
            }
            const model = config.WHISPER_MODEL || process.env.WHISPER_MODEL || 'whisper-1';
            const outcome = compatible ? await viaCompatible(req, model) : await viaOpenAi(req, model);
            return res.status(outcome.status).json(outcome.body);
        } catch (e) {
            logger.error(`transcribe error: ${e && e.message ? e.message : e}`);
            return res.status(500).json({ status: false, statusText: (e && e.message) || 'Transcription error.' });
        }
    },
];
