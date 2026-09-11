const { requireInstanceAdmin } = require('../Instance/guard');
const { DateTime } = require("luxon");
const fs = require("fs");
const config =  require('../../Config/config.js');
const { connections } = require("../../middlewares/mongoConnector/helper.js");
const commonctrl = require('./controller.js');

/**
 * Init
 * @param {Object} app 
 */
exports.init = (app) => {
    app.get("/api/v1/getTime", (req, res) => {
        const zone = String(req.query?.zone || '');
        if (!zone) {
            return res.status(400).json({ status: false, statusText: 'zone is required', message: 'zone is required' });
        }
        const now = DateTime.now().setZone(zone);
        if (!now.isValid) {
            return res.status(400).json({ status: false, statusText: 'zone is not a known time zone', message: now.invalidExplanation || 'invalid zone' });
        }
        return res.json({ status: true, statusText: 'Current time.', data: now.toISO() });
    });

    // Get Email Templates
    app.get("/api/v1/getEmailTemplates", (req, res) => {
        res.send({verifyEmail: require("../Template/sendEmailVerification.js")('${link}','','${brandName}'),resetEmail: require("../Template/forgotPassword.js")('${email}', '${link}','${brandName}'), invitationEamil: require("../Template/sendEmailInvitation.js")('${link}','${companyName}','${brandName}')});
    });

    // Get Connections
    app.get("/connections/:id", (req, res) => {
        if (req.params && req.params.id && req.params.id === config.PRECOMPANYKEY) {
            const connectionsJSON = connections.map((x) => ({
                db: x.db,
                createdAt: new Date(x.createdAt),
                lastRequest: new Date(x.lastRequest)
            }))
            res.json({data: connectionsJSON, total: connectionsJSON.length});
        } else {
            res.send('Unauthorized');
        }
    });

    /**
     * Create Default Folder
     */
    exports.createDefaultFolder = () => {
        const folderPaths = [
            `${__dirname}/../../wasabiUploads`,
            `${__dirname}/../../thumbnails`,
            `${__dirname}/../../storage`,
            `${__dirname}/../../storage/USER_PROFILES`
        ];
    
        for (let i = 0; i < folderPaths.length; i += 1) {
            if (!fs.existsSync(folderPaths[i])){
                fs.mkdirSync(folderPaths[i]);
            }
        }
    };
    exports.createDefaultFolder();

    app.post('/api/v1/versionUpdateNotify', requireInstanceAdmin, commonctrl.versionUpdateNotifyToClient)

};
