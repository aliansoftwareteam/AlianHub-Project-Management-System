const express = require("express");
const fs = require("fs");
var cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Global error handlers — catch crashes and log before Render kills the process
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err.message);
    console.error(err.stack);
    process.exit(1);
});
// Log and keep serving. Exiting here turned every handler that forgot to answer
// (an unhandled rejection from a bad request body) into a process kill anyone
// could trigger over HTTP. uncaughtException still exits: that is corrupted state.
process.on('unhandledRejection', (reason, promise) => {
    console.error('[unhandledRejection] at:', promise);
    console.error('[unhandledRejection] reason:', reason && reason.stack ? reason.stack : reason);
});
const bodyParser = require("body-parser");
const config =  require('./Config/config.js');
const { loadDotEnv, applyEnvMap } = require('./Config/applyEnv.js');
loadDotEnv();
const { makeDefaultBrandSettings } = require("./Modules/Admin/common/controller.js");
const { corsOriginDelegate } = require('./utils/cors.js');
const { getHealth } = require('./Modules/Instance/health.js');

const app = express();
// Honour X-Forwarded-For from the reverse proxy in front of the process, so rate
// limiting keys on the client and not on the proxy. TRUST_PROXY takes a hop count
// or "true" for hosted setups.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

// CORS allow-list is env-driven; see utils/cors.js.
app.use(cors({ origin: corsOriginDelegate }));

// CSP stays off: the Vue bundle uses inline scripts and styles in production.
if (process.env.HELMET_ENABLED !== 'false') {
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
    }));
}

// API traffic only: static assets and socket.io are never counted, so an SPA cold
// load cannot trip the limit. 0 / off disables it for internal deployments.
const rawGlobalLimit = String(process.env.GLOBAL_RATE_LIMIT_PER_MIN ?? '1000').trim().toLowerCase();
if (!['0', 'off', 'false', 'no', 'disabled'].includes(rawGlobalLimit)) {
    const STATIC_ASSET_RX = /\.(js|mjs|css|map|svg|png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|eot|html?|mp4|webm|mp3|wav|pdf)$/i;
    app.use(rateLimit({
        windowMs: 60 * 1000,
        max: Math.max(1, Number(rawGlobalLimit) || 1000),
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => req.path.startsWith('/socket.io/') || STATIC_ASSET_RX.test(req.path)
            || req.path === '/' || req.path.startsWith('/assets/') || req.path.startsWith('/static/'),
    }));
}
// 2MB covers every JSON body the app sends; uploads go through multer with their
// own limits. BODY_LIMIT raises it for bulk imports.
const BODY_LIMIT = process.env.BODY_LIMIT || '2mb';
app.use(bodyParser.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(bodyParser.json({ limit: BODY_LIMIT }));
app.use(bodyParser.raw({ limit: BODY_LIMIT }));

app.use(express.static(path.join(__dirname, './frontend/dist')));
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, './frontend/dist/index.html'));
});
app.use(require('./Modules/Instance/maintenance.js').maintenanceGuard);

// ADD DEFAULT BRAND SETTINGS
makeDefaultBrandSettings()
.catch((error) => {
    console.log("makeDefaultBrandSettings: ", error);
});

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});
// Real 4xx for API/MCP tokens and anyone sending Prefer: status-codes; the app keeps its 200 + {status:false}.
app.use(require('./Config/strictStatus').strictStatus());

function initializeControllers() {
    const { startInterval } = require("./middlewares/mongoConnector/helper.js");
    startInterval();
    const { currentDirectory } = require(`./common-storage/common-${process.env.STORAGE_TYPE}.js`);
    const { preCompanySetup, } = require("./Modules/Company/controller2.js");
    app.get("/api/v1/setPresetCompany/:id", (req, res) => {
        if (req.params && req.params.id && req.params.id === config.PRECOMPANYKEY) {
            preCompanySetup();
            res.send('Preset Company Process Start Successful');
        } else {
            res.send('Unauthorized');
        }
    })
    //IMPORT CUSTOM FILES
    require('./Modules/Auth/init').init(app);
    require('./Modules/SSO/init').init(app);
    require('./Modules/Audit/init').init(app);
    require('./Modules/Agents/init').init(app);
    require('./Modules/Mcp/init').init(app);
    require('./Modules/Scim/init').init(app);
    require('./Modules/Pto/init').init(app);
    require('./Modules/Portfolio/init').init(app);
    require('./Modules/ProjectDashboard/init').init(app);
    require('./Modules/CustomReports/init').init(app);
    require('./Modules/VarianceReport/init').init(app);
    require('./Modules/CapacityPlanning/init').init(app);
    require('./Modules/ScheduledReports/init').init(app);
    require('./Modules/EmailIn/init').init(app);
    require('./Modules/Calendar/init').init(app);
    require('./Modules/Automations/init').init(app);
    require('./Modules/Integrations/init').init(app);
    require('./Modules/CloudStorage/init').init(app);
    require('./Modules/Inbox/init').init(app);
    require('./Modules/notification1/init').init(app);
    require('./Modules/ImportSettings/init').init(app);
    require('./Modules/Tasks/init.js').init(app);
    require('./Modules/Sprints/init.js').init(app);
    require('./Modules/Calls/init.js').init(app);
    require('./Modules/AgileReports/init').init(app);
    require('./Modules/Export/init').init(app);
    require('./Modules/RecurringTasks/init').init(app);
    require('./Modules/Reminders/init').init(app);
    require('./Modules/GeneralReminders/init').init(app);
    require('./Modules/Notes/init').init(app);
    require('./Modules/Clips/init').init(app);
    require('./Modules/LogTime/init.js').init(app);
    require('./Modules/TimesheetApproval/init').init(app);
    require('./Modules/Milestone/init.js').init(app);
    require('./Modules/Company/init.js').init(app);
    require('./Modules/trackerDownload/init.js').init(app);
    require('./Modules/notification/notification-middleware/init').init(app);
    require('./Modules/notification/prepare-notification-data/init').init(app);
    require('./Modules/projectSetting/init').init(app);
    require('./Modules/taskIndex/init').init(app);
    require('./Modules/createProject/init.js').init(app);
    require('./Modules/notification-count/init').init(app);
    require('./Modules/notification/sendEmail/init').init(app);
    require('./Modules/trackerUserPermission/init').init(app);
    require('./Modules/Instance/init').init(app);
    require('./Modules/ScreenshotRetention/init').init(app);
    require('./Modules/projectClose/init').init(app);
    if (process.env.CRON_ENABLED !== 'false') {
        require('./cron.js');
    }
    require('./Modules/Admin/admin.js').init(app);
    require('./Modules/emailTemplate/init').init(app);
    require('./Modules/EmailNotification/init').init(app);
    require(`./Modules/storage/${currentDirectory}/init`).init(app);
    require('./Modules/AI/init').init(app);
    require('./Modules/AIProjectGenerator/init').init(app);
    require('./Modules/Users/init').init(app);
    require('./Modules/Project/init').init(app);
    require('./Modules/PersonalList/init').init(app);
    require('./Modules/Teams/init').init(app);
    require('./Modules/tours/init').init(app);
    require('./Modules/AdvancedGlobalFilter/init.js').init(app);
    require('./Modules/settings/settingCurrency/init').init(app);
    require('./Modules/settings/settingNotifications/init').init(app);
    require('./Modules/projectRules/init').init(app);
    require('./Modules/Webhooks/init').init(app);
    require('./Modules/Reactions/init').init(app);
    require('./Modules/RecentVisits/init').init(app);
    require('./Modules/GlobalSearch/init').init(app);
    require('./Modules/Epics/init').init(app);
    require('./Modules/ExportJobs/init').init(app);
    require('./Modules/ApiTokens/init').init(app);
    require('./Modules/Pages/init').init(app);
    require('./Modules/Forms/init').init(app);
    require('./Modules/PublicShares/init').init(app);
    require('./Modules/Importers/init').init(app);
    require('./Modules/EstimatedTime/init').init(app);
    require('./Modules/CustomField/init').init(app);
    require('./Modules/ProjectTemplates/init').init(app);
    require('./Modules/settings/templates/init').init(app);
    require('./Modules/settings/ProjectStatusTemplate/init').init(app);
    require('./Modules/settings/securityPermissions/init').init(app);
    require('./Modules/settings/restrictedExtensions/init').init(app);
    require('./Modules/UserId/init').init(app);
    require('./Modules/settings/Members/init').init(app);
    require('./Modules/Apps/init').init(app)
    require('./Modules/projectTabs/init').init(app)
    require('./Modules/Comments/init').init(app);
    require('./Modules/TimeSheet/init').init(app);
    require('./Modules/MainChats/init').init(app);
    require('./Modules/notification/app-notification/init').init(app);
    require('./Modules/History/init').init(app);
    require('./Modules/settings/Category/init').init(app);
    require('./Modules/settings/Roles/init').init(app);
    require('./Modules/settings/Designation/init').init(app);
    require('./Modules/settings/ProjectSkills/init').init(app);
    require('./Modules/settings/CompanyUserStatus/init').init(app);
    require('./Modules/settings/fileExtensions/init').init(app);
    require('./Modules/settings/commonDateFormate/init').init(app);
    require('./Modules/settings/taskPriority/init').init(app);
    require('./Modules/settings/settingMilestone/init').init(app);
    require('./Modules/MediaFiles/init').init(app);
    require("./Modules/SubscriptionPlan/init").init(app);
    require("./Modules/subscription/init").init(app);
    require("./Modules/PlanFeature/init").init(app);
    require("./Modules/Invoice/init").init(app);
    require("./Modules/generateMongoId/init").init(app);
    require("./Modules/UserDashboard/init.js").init(app);
    require("./Modules/Affiliate/init").init(app);
    require("./Modules/OAuth/init.js").init(app);
    require("./Modules/githubOAuth/init.js").init(app);
    require("./Modules/googleOAuth/init.js").init(app);
    require("./Modules/gitlabOAuth/init.js").init(app);
    require("./Modules/Changelog/init.js").init(app);
}

// SET MIDDLEWARE
// require('./Config/setMiddleware.js').setMiddlewareWithC(app);
// require('./Config/setMiddleware.js').setMiddleware(app);
require('./Config/setMiddleware.js').setMiddlewareWithCV2(app);
require('./Config/setMiddleware.js').setMiddlewareV2(app);

/* Settings saved in the database are applied before any module loads, because the
 * storage driver and the AWS clients are chosen at require time. A database that
 * is down is skipped within seconds so the setup page can say so. */
async function applySavedSettings() {
    if (!process.env.MONGODB_URL) return;
    const { checkDb } = require('./Modules/Instance/health.js');
    const db = await checkDb();
    if (!db.ok) { console.error(`instance settings: skipped, ${db.error}`); return; }
    try {
        await require('./Config/instanceSettings.js').loadInstanceSettings(require('./Config/loggerConfig'));
    } catch (error) {
        console.error(`instance settings: could not load, ${error.message}`);
    }
}

(async () => {
    await applySavedSettings();
    if (!process.env.STORAGE_TYPE) applyEnvMap({ STORAGE_TYPE: 'wasabi' });
    if (process.env.MONGODB_URL) {
        initializeControllers();
    }

    // Registered outside initializeControllers so the wizard can report a missing database.
    require('./Modules/Setup/init').init(app);

    // SWAGGER CONFIGURATION
    require('./Modules/swaggerAPI/init').init(app, config.APIURL);

    // COMMON CODE 
    require('./Modules/common/init').init(app);

    const { initSocket } = require("./socket/socketinit.js");
    app.get("/health", async (req, res) => {
        const { httpStatus, body } = await getHealth();
        res.status(httpStatus).json(body);
    });

    fs.watch(__dirname + "/Modules/Template/", (event_type, file_name) => {
        try {
            delete require.cache[require.resolve(__dirname + "/Modules/Template/" + file_name)];;
        } catch (error) {
            console.error("ERROR in remove cache", error);
        }
    });

    app.use(require('./Config/spaFallback').spaFallback(path.join(__dirname, './frontend/dist/index.html')));

    if (process.env.MONGODB_URL) {
        await require('./migrations').runMigrationsAtBoot();
    }
    const server = app.listen(config.PORT, () => {
        console.log("Server ready on " + config.PORT);
    });
    initSocket(server);
})();
