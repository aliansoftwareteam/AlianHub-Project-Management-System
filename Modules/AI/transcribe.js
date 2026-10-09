// Talk to Text: POST /api/v1/ai/transcribe (multipart/form-data, field "file") → { status: true, data: { text } }.
// Audio goes where chat goes: the instance's OpenAI-compatible server when it
// answers chat (so a self-hosted instance uploads nothing to OpenAI), otherwise
// OpenAI at OPENAI_BASE_URL with config.OPENAI_API_KEY or config.AI_API_KEY.
// Each call is booked to the workspace's AI budget by the audio minute.
const multer = require('../../utils/contextMulter');
const config = require('../../Config/config');
const logger = require('../../Config/loggerConfig');
const aiSwitch = require('../AICore/aiSwitch');
const { apiKeyFor } = require('../AICore/providerKeys');
const compatibleClient = require('../AICore/llmProvider/compatibleClient');
const { embeddingProviderName } = require('../AICore/llmProvider/embeddingChoice');
const openaiProvider = require('../AICore/llmProvider/openaiProvider');
const spend = require('../AICore/spend');
const { BUDGET_EXHAUSTED } = require('../AICore/reservation');
const { AUDIO_FEATURES } = require('../AICore/features');
const audioDuration = require('./audioDuration');

const TRANSCRIBE_TIMEOUT_MS = 120000;

// Whisper's hard limit is 25 MB; keep the (short) dictation in memory.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } });

/* whisper-1 on OpenAI's price list. A self-hosted server costs nothing unless WHISPER_USD_PER_MINUTE names a price. */
const LIST_USD_PER_MINUTE = 0.006;

const usdPerMinute = (compatible) => {
    const raw = String(process.env.WHISPER_USD_PER_MINUTE || '').trim();
    const set = Number(raw);
    if (raw !== '' && Number.isFinite(set) && set >= 0) return set;
    return compatible ? 0 : LIST_USD_PER_MINUTE;
};

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
    if (req.body && req.body.language) form.append('language', String(req.body.language));
    return form;
};

const NOT_CONFIGURED = { status: 503, body: { status: false, statusText: 'Speech-to-text is not configured.' } };

const NOT_AUDIO = { status: 400, body: { status: false, statusText: 'That file is not audio. Send a WebM, MP4, M4A, MP3, WAV, Ogg or FLAC recording.' } };

const configured = (compatible) => (compatible
    ? !!String(process.env.OPENAI_COMPATIBLE_BASE_URL || '').trim()
    : !!(config.OPENAI_API_KEY || config.AI_API_KEY));

const vendorFailure = (status) => Object.assign(new Error(`Transcription failed (${status}).`), { vendorFailure: true });

/* The vendor states the audio's length as `usage: { type: 'duration', seconds }`, or as `duration` in its verbose answer;
 * a model billed by tokens, and most self-hosted servers, state neither. */
const answered = (data) => {
    const text = data && typeof data.text === 'string' ? data.text.trim() : '';
    const usage = data && data.usage;
    const seconds = Number(usage && usage.type === 'duration' ? usage.seconds : data && data.duration);
    return { text, seconds: Number.isFinite(seconds) ? seconds : null };
};

async function viaCompatible(req, model) {
    const baseUrl = String(process.env.OPENAI_COMPATIBLE_BASE_URL || '').trim();
    try {
        const response = await compatibleClient.request({ baseUrl, path: '/audio/transcriptions', body: formFor(req, model), apiKey: await apiKeyFor('openai_compatible'), timeoutMs: TRANSCRIBE_TIMEOUT_MS });
        return answered(response.data);
    } catch (error) {
        const status = error.response && error.response.status;
        logger.error(`transcribe: compatible endpoint ${status || ''} ${compatibleClient.describeFailure(error)}`);
        throw vendorFailure(status || 'unreachable');
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
        throw vendorFailure(response.status);
    }
    return answered(await response.json().catch(() => ({})));
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
            if (!audioDuration.isAudioFile(req.file.buffer)) return res.status(NOT_AUDIO.status).json(NOT_AUDIO.body);
            const model = config.WHISPER_MODEL || process.env.WHISPER_MODEL || 'whisper-1';
            let answer;
            try {
                answer = await spend.audio({
                    spend: { feature: AUDIO_FEATURES.TRANSCRIPTION, companyId: req.headers.companyid, userId: req.uid },
                    model, provider: compatible ? 'openai_compatible' : 'openai', usdPerMinute: usdPerMinute(compatible),
                    ...audioDuration.measure(req.file.buffer),
                }, () => (compatible ? viaCompatible(req, model) : viaOpenAi(req, model)));
            } catch (error) {
                if (error.code === BUDGET_EXHAUSTED) return res.json({ status: false, statusText: error.message });
                if (error.vendorFailure) return res.status(502).json({ status: false, statusText: error.message });
                throw error;
            }
            return res.json({ status: true, data: { text: answer.text } });
        } catch (e) {
            logger.error(`transcribe error: ${e && e.message ? e.message : e}`);
            return res.status(500).json({ status: false, statusText: (e && e.message) || 'Transcription error.' });
        }
    },
];
