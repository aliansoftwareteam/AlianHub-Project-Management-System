// Talk to Text — speech-to-text via OpenAI Whisper.
// POST /api/v1/ai/transcribe  (multipart/form-data, field name: "file")
//   → { status: true, data: { text } }
// Reuses the existing OpenAI key (config.AI_API_KEY); a dedicated
// config.OPENAI_API_KEY takes precedence if set. Node 18+ globals
// (fetch / FormData / Blob) are used to forward the audio to Whisper, so no
// extra dependency is needed.
const multer = require('multer');
const config = require('../../Config/config');
const logger = require('../../Config/loggerConfig');

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

exports.transcribe = [
    uploadMiddleware,
    async (req, res) => {
        try {
            const apiKey = config.OPENAI_API_KEY || config.AI_API_KEY;
            if (!apiKey) {
                return res.status(503).json({ status: false, statusText: 'Speech-to-text is not configured.' });
            }
            if (!req.file || !req.file.buffer || !req.file.buffer.length) {
                return res.status(400).json({ status: false, statusText: 'No audio received (field name: file).' });
            }

            const model = config.WHISPER_MODEL || 'whisper-1';
            const form = new FormData();
            const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
            form.append('file', blob, req.file.originalname || 'audio.webm');
            form.append('model', model);
            form.append('response_format', 'json');
            // Optional caller hint: a 2-letter language code improves accuracy.
            if (req.body && req.body.language) form.append('language', String(req.body.language));

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}` },
                body: form,
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                logger.error(`transcribe: Whisper ${response.status}: ${errText}`);
                return res.status(502).json({ status: false, statusText: `Transcription failed (${response.status}).` });
            }

            const data = await response.json().catch(() => ({}));
            const text = data && typeof data.text === 'string' ? data.text.trim() : '';
            return res.json({ status: true, data: { text } });
        } catch (e) {
            logger.error(`transcribe error: ${e && e.message ? e.message : e}`);
            return res.status(500).json({ status: false, statusText: (e && e.message) || 'Transcription error.' });
        }
    },
];
