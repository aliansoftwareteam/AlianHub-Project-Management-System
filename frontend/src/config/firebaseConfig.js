// Firebase push keys are read at build time (frontend/.env): the messaging service
// worker is generated then and cannot ask the server. Kept here so the SPA and the
// worker agree; docs/ADMIN-GUIDE.md#configure says so.
let configs = {};

configs = {
    apiKey: process.env.VUE_APP_APIKEY,
    authDomain:process.env.VUE_APP_AUTHDOMAIN,
    projectId:process.env.VUE_APP_PROJECTID,
    storageBucket:process.env.VUE_APP_STORAGEBUCKET,
    messagingSenderId:process.env.VUE_APP_MESSAGINGSENDERID,
    appId:process.env.VUE_APP_APPID,
    measurementId:process.env.VUE_APP_MEASUREMENTID
};

export default configs;