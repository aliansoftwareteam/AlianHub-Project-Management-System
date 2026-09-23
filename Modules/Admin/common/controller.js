const fs = require("fs");
const path = require("path");
const logger = require("../../../Config/loggerConfig");
const { sendStoredFile } = require("../../storage/server/helpers/downloadHeaders");


const LOGO_ROOT = path.join(__dirname, '../../../public/images');

const logoFolderFor = ({ key, type } = {}) => {
    if (!key) return 'admin-logo';
    if (key === 'favicon') return 'favicon';
    if (key === 'defaultuser') return 'default-user-image';
    if (key === 'ghostuser') return 'ghost-user-image';
    if (key === 'logo' && type === 'admin') return 'admin-logo';
    if (key === 'logo' && type === 'desktop') return 'desktop-logo';
    if (key === 'logo' && type === 'emailTemplateLogo') return 'emailTemplateLogo';
    return 'web-logo';
};

const logoNotFound = (res) => res.status(404).send({ status: false, statusText: 'Not Found', message: 'Logo not found' });

// Operator-uploaded files are served from the app's own origin, so they carry the stored-file sandbox headers.
const createLogoHandler = (imagesRoot) => (req, res) => {
    const folder = path.join(imagesRoot, logoFolderFor(req.query || {}));
    fs.readdir(folder, (err, files) => {
        if (err) {
            logger.error(`logo folder not readable: ${err.code || err.message}`);
            return logoNotFound(res);
        }
        const fileName = files.filter((file) => !file.startsWith('.')).pop();
        if (!fileName) return logoNotFound(res);
        sendStoredFile(res, path.join(folder, fileName));
    });
};

exports.createLogoHandler = createLogoHandler;
exports.getlogo = createLogoHandler(LOGO_ROOT);


exports.makeDefaultBrandSettings = () => {
    return new Promise((resolve, reject) => {
        try {
            let defaultJsonAlianHub = {
                "productName": "Alian Hub",
                // "productDescription": "Welcome to User Guide of all-in-one project management system - Alian Hub. You will find detailed instructions, steps and helpful hints for your queries here. From getting started by creating your first project to ensuring that your team has access to all of the resources they need, checking the status of the project and successfully completing the tasks. This user guide will lead you across anything you need to learn and understand. You can view the details of every query through the sections of this user guide.",
                "termsOfService": "https://alianhub.com/terms-and-conditions/",
                "privacyPolicy": "https://alianhub.com/privacy-policy/",
                "helpLink":"https://help.alianhub.com/"
            };
            const filePath = path.join(__dirname, '/../../../' , 'brandSettings.json');
            if (!fs.existsSync(filePath)) {
                fs.writeFile(filePath, JSON.stringify(defaultJsonAlianHub, null, 2), (err) => {
                    if (err) {
                        logger.error('Error writing file getBrandSettingsData:', err);
                        reject(err)
                    } else {
                        resolve(defaultJsonAlianHub);
                    }
                });
            } else {
                reject("File already exists")
            }
        } catch (error) {
            reject(error)
        }
    })
}

exports.getBrandSettingsData = (req, res) => {
    try {
        // Public demo flag (+ shared demo creds) surfaced on this already-public,
        // pre-auth endpoint so the demo banner / login can read it without a
        // build-time var. Off unless DEMO_MODE=true in the server env.
        const demo = process.env.DEMO_MODE === 'true';
        const withDemo = (obj) => ({
            ...obj,
            demoMode: demo,
            ...(demo ? { demoEmail: process.env.DEMO_EMAIL || '', demoPassword: process.env.DEMO_PASSWORD || '' } : {}),
        });

        const filePath = path.join(__dirname,'/../../../', 'brandSettings.json');

        if (!fs.existsSync(filePath)) {
            exports.makeDefaultBrandSettings()
            .then((data) => {
                // makeDefaultBrandSettings resolves an OBJECT (not a JSON string),
                // so it must not be JSON.parse'd — that threw on first run.
                res.status(200).json(withDemo(data));
            })
            .catch((error) => {
                res.status(404).send(error);
            })
        } else {
            fs.readFile(filePath, 'utf8', (err, data) => {
                if (err) {
                    logger.error('Error writing file getBrandSettingsData:', err);
                    return res.status(500).send('Internal Server Error');
                }
                res.status(200).json(withDemo(JSON.parse(data)));
            });
        }
    } catch (error) {
        res.status(404).send(error);
    }
}