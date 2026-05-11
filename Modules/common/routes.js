const { DateTime } = require("luxon");
const fs = require("fs");
const config =  require('../../Config/config.js');
const { connections } = require("../../middlewares/mongoConnector/helper.js");
const commonctrl = require('./controller.js');
const { requirePresetKey } = require('../../utils/presetKeyAuth.js');

/**
 * Init
 * @param {Object} app 
 */
exports.init = (app) => {
    // Get Time
    app.get("/api/v1/getTime", (req, res) => {
        if(!req.query?.zone) {
            res.send("No zone specified");
        } else {
            res.send(DateTime.now().setZone(req.query.zone));
        }
    });

    // Get Email Templates
    app.get("/api/v1/getEmailTemplates", (req, res) => {
        res.send({verifyEmail: require("../Template/sendEmailVerification.js")('${link}','','${brandName}'),resetEmail: require("../Template/forgotPassword.js")('${email}', '${link}','${brandName}'), invitationEamil: require("../Template/sendEmailInvitation.js")('${link}','${companyName}','${brandName}')});
    });

    // Get Connections
    // BUG-008 / #62 fix: was `GET /connections/:id` with the PRECOMPANYKEY
    // secret as a URL path segment. Now POST with the key in the
    // `x-preset-key` header, constant-time compared by the middleware.
    app.post("/connections", requirePresetKey, (req, res) => {
        const connectionsJSON = connections.map((x) => ({
            db: x.db,
            createdAt: new Date(x.createdAt),
            lastRequest: new Date(x.lastRequest)
        }));
        res.json({ data: connectionsJSON, total: connectionsJSON.length });
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

    app.post('/api/v1/versionUpdateNotify',commonctrl.versionUpdateNotifyToClient)

};
