const crypto = require('crypto');
const mongoose = require('mongoose');
const mongoC = require('../../../utils/mongo-handler/mongoQueries');
const { dbCollections } = require('../../../Config/collections');
const config = require('../../../Config/config');
const logger = require('../../../Config/loggerConfig');
const sendMail = require('../../service.js');
const magicLinkMail = require('../../Template/sendMagicLink.js');
const { finalizeSession } = require('./loginSession');

const TTL_SECONDS = 15 * 60;
const PER_EMAIL_LIMIT = 3;
const PER_EMAIL_WINDOW = 10 * 60;

const isEnabled = () => String(process.env.MAGIC_LINK_ENABLED || 'true') !== 'false';
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const safeRedirect = (raw) => {
    const value = String(raw || '');
    return value.startsWith('/') && !value.startsWith('//') ? value : '';
};

const findUserByEmail = (email) => mongoC.MongoDbCrudOpration('global', {
    type: dbCollections.USERS,
    data: [{ Employee_Email: email, deletedStatusKey: { $in: [0, null, undefined] } }]
}, 'findOne');

/* POST /api/v2/auth/magic-link { email, redirect_url } — always answers 200 so it never reveals which emails exist. */
exports.requestMagicLink = async (req, res) => {
    try {
        if (!isEnabled()) return res.send({ status: false, statusText: 'disabled' });
        const email = String((req.body && req.body.email) || '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            return res.status(400).json({ status: false, message: 'A valid email is required.' });
        }
        const limitKey = `magic:limit:${email}`;
        const sent = Number(config.myCache.get(limitKey) || 0);
        if (sent >= PER_EMAIL_LIMIT) return res.status(429).json({ status: false, message: 'Auth.too_many_request' });
        config.myCache.set(limitKey, sent + 1, PER_EMAIL_WINDOW);

        const user = await findUserByEmail(email);
        if (user && user._id && user.isEmailVerified !== false && user.isActive !== false) {
            const token = crypto.randomBytes(32).toString('base64url');
            config.myCache.set(`magic:${hash(token)}`, { uid: String(user._id), redirect: safeRedirect(req.body.redirect_url) }, TTL_SECONDS);
            const link = `${config.APIURL}api/v2/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
            const mail = magicLinkMail(link, TTL_SECONDS / 60);
            await new Promise((resolve) => sendMail.SendEmail(mail.subject, mail.mail, email, true, (result) => {
                if (!result.status) logger.error(`magic-link mail failed for ${email}: ${result.error}`);
                resolve();
            }));
        }
        return res.send({ status: true, statusText: 'If that address has an account, a login link is on its way.' });
    } catch (error) {
        logger.error(`requestMagicLink: ${error.message || error}`);
        return res.status(500).json({ status: false, message: error.message });
    }
};

/* GET /api/v2/auth/magic-link/verify?token= — single use; sets the session cookies and returns to the SPA. */
exports.verifyMagicLink = async (req, res) => {
    const back = (query) => res.redirect(`${config.WEBURL}/#/login?${query}`);
    try {
        if (!isEnabled()) return back('magic=disabled');
        const token = String((req.query && req.query.token) || '');
        const key = token ? `magic:${hash(token)}` : '';
        const entry = key ? config.myCache.get(key) : null;
        if (!entry) return back('magic=invalid');
        config.myCache.del(key);
        const user = await mongoC.MongoDbCrudOpration('global', {
            type: dbCollections.USERS,
            data: [{ _id: new mongoose.Types.ObjectId(entry.uid) }]
        }, 'findOne');
        if (!user || !user._id) return back('magic=invalid');

        const redirect = entry.redirect ? `&redirect_url=${encodeURIComponent(entry.redirect)}` : '';
        finalizeSession(req, res, String(user._id), () => back('magic=invalid'), (payload) => {
            res.redirect(`${config.WEBURL}/#/login?magic=ok&uid=${encodeURIComponent(payload.uid)}${redirect}`);
        });
    } catch (error) {
        logger.error(`verifyMagicLink: ${error.message || error}`);
        return back('magic=invalid');
    }
};
