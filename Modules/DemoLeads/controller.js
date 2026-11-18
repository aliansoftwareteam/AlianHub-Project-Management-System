const axios = require('axios');
const logger = require('../../Config/loggerConfig');

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/;

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

exports.createLead = async (req, res) => {
    const body = req.body || {};
    const name = clean(body.name, 100);
    const email = clean(body.email, 254);
    const findFrom = clean(body.findFrom, 100);
    const findFromOther = findFrom === 'Other' ? clean(body.findFromOther, 200) : '';

    if (!name || !email || !EMAIL_RE.test(email) || !findFrom) {
        return res.status(400).json({ status: false, statusText: 'Invalid input', message: 'Name, a valid email and where you heard about us are required.' });
    }

    const sheetUrl = process.env.DEMO_LEADS_SHEET_URL;
    if (!sheetUrl) {
        logger.error('[DemoLeads] DEMO_LEADS_SHEET_URL is not set; lead not saved');
        return res.status(503).json({ status: false, statusText: 'Not configured', message: 'Lead capture is not configured.' });
    }

    try {
        const response = await axios.post(sheetUrl, {
            timestamp: new Date().toISOString(),
            name,
            email,
            findFrom,
            findFromOther,
            page: clean(body.page, 300),
        }, { timeout: 10000 });
        // A wrong URL (e.g. the sheet's own /edit link) still answers 200 with an HTML page, so only the script's JSON reply counts as saved.
        if (!response.data || response.data.ok !== true) {
            throw new Error('Unexpected reply from DEMO_LEADS_SHEET_URL; it must be the Apps Script web-app /exec URL');
        }
        return res.json({ status: true, statusText: 'Saved', data: {} });
    } catch (error) {
        logger.error(`[DemoLeads] Google Sheet append failed: ${error.message}`);
        return res.status(502).json({ status: false, statusText: 'Save failed', message: 'Could not save your details right now.' });
    }
};
