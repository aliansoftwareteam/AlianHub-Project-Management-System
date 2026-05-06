const path = require('path');

//Initialize Admin
let admin = null;
let fcm = null;

try {
    admin = require("firebase-admin");
    const config = require('./config');

    if (!config.SERVICE_FILE) {
        console.log("Firebase: SERVICE_FILE not configured — push notifications disabled.");
    } else {
        const serviceFilePath = path.resolve(__dirname, '..', config.SERVICE_FILE);
        const serviceAccount = require(serviceFilePath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        fcm = admin.messaging();
        console.log("Firebase: initialized successfully.");
    }
} catch (error) {
    console.log("Firebase Error (push notifications disabled):", error.message);
    // Provide a stub so callers don't crash when admin is null
    admin = admin || {};
}

module.exports = {
    admin,
    fcm
};
