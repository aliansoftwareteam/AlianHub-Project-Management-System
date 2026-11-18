const fs = require('fs');
const path = require('path');
const { drivePickerPolicy } = require('../../Config/contentSecurityPolicy');

const DRIVE_PAGE_PATH = '/pickers/google-drive';
const DRIVE_SCRIPT_PATH = '/pickers/google-drive.js';

const staticFile = (name) => fs.readFileSync(path.join(__dirname, 'static', name), 'utf8');

/* Public by design and outside /api: the page holds no session or data of its own. It is opened by the app,
 * which hands it the picker settings over postMessage once it is loaded. */
exports.init = (app, env = process.env) => {
    const page = staticFile('google-drive.html');
    const script = staticFile('google-drive.js');
    const policy = drivePickerPolicy(env);

    app.get(DRIVE_PAGE_PATH, (req, res) => {
        res.set({ 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' }).type('html').send(page);
    });
    app.get(DRIVE_SCRIPT_PATH, (req, res) => {
        res.set('Cache-Control', 'no-store').type('application/javascript').send(script);
    });
};

exports.DRIVE_PAGE_PATH = DRIVE_PAGE_PATH;
exports.DRIVE_SCRIPT_PATH = DRIVE_SCRIPT_PATH;
