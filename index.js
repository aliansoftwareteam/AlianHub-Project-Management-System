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
process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] unhandledRejection at:', promise);
    console.error('[FATAL] Reason:', reason);
    process.exit(1);
});
const bodyParser = require("body-parser");
const config =  require('./Config/config.js');
const awsRef =  require('./Config/aws.js');
const logger = require("./Config/loggerConfig");
const packJOSNData = require("./package.json");
const { makeDefaultBrandSettings } = require("./Modules/Admin/common/controller.js");
const { corsOriginDelegate } = require('./utils/cors.js');

const app = express();
// Trust the loopback proxy by default so X-Forwarded-For is honored when
// nginx (or any same-host reverse proxy) sits in front of the Node
// process. Without this, express-rate-limit logs
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and may key all clients by the
// proxy IP. Override via TRUST_PROXY env (e.g. "1" for one upstream, or
// "true" for any). Safe in dev because requests from outside loopback
// fall back to req.connection.remoteAddress.
// app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

// CORS — BUG-002 / #56. Replace wildcard with an env-driven allow-list.
// See utils/cors.js for the exact rules and supported env vars.
app.use(cors({ origin: corsOriginDelegate }));

// Security headers. CSP is intentionally disabled — the Vue frontend uses
// inline scripts/styles in production. crossOriginEmbedderPolicy is off so
// existing third-party embeds keep working. Everything else (HSTS,
// X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.) is on
// with helmet defaults.
// app.use(helmet({
//     contentSecurityPolicy: false,
//     crossOriginEmbedderPolicy: false,
//     crossOriginResourcePolicy: { policy: 'cross-origin' },
// }));

// Global rate limiting. Counts only API traffic — static assets and
// socket.io are skipped so SPA cold-loads can't trip the limit. Set
// GLOBAL_RATE_LIMIT_PER_MIN=0 (or "off"/"false") to disable entirely;
// useful for internal deployments where auth-level brute-force
// protection (Modules/Auth/helper.js#manageResetAttempt) is enough.
// const rawGlobalLimit = String(process.env.GLOBAL_RATE_LIMIT_PER_MIN ?? '10000').trim().toLowerCase();
// const rateLimitDisabled = ['0', 'off', 'false', 'no', 'disabled'].includes(rawGlobalLimit);

// if (!rateLimitDisabled) {
//     const GLOBAL_RATE_LIMIT = Math.max(1, Number(rawGlobalLimit) || 10000);
//     const STATIC_ASSET_RX = /\.(js|mjs|css|map|svg|png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|eot|html?|mp4|webm|mp3|wav|pdf)$/i;

//     app.use(rateLimit({
//         windowMs: 60 * 1000,
//         max: GLOBAL_RATE_LIMIT,
//         standardHeaders: true,
//         legacyHeaders: false,
//         // Don't count anything that isn't a real API call. Socket.io has
//         // its own throttling; static assets are not a DoS vector here.
//         skip: (req) => {
//             if (req.path.startsWith('/socket.io/')) return true;
//             if (STATIC_ASSET_RX.test(req.path)) return true;
//             if (req.path === '/' || req.path.startsWith('/assets/') || req.path.startsWith('/static/')) return true;
//             return false;
//         },
//     }));
// }
// BUG-037 / #91 — body limits.
// Previously every endpoint accepted 50MB JSON/url-encoded/raw bodies,
// so any unauthenticated POST could spend the request loop buffering
// 50MB before validation even runs. Drop the default to 2MB (well above
// typical JSON payloads — comments, settings, project data — but blocks
// the trivial multi-MB DoS). File uploads use `multer` and have their
// own limits (see Modules/storage/**), so this only constrains
// body-parser-handled paths. Operators with bulk-import or large-form
// use cases can raise it via the `BODY_LIMIT` env var.
const BODY_LIMIT = process.env.BODY_LIMIT || '2mb';
app.use(bodyParser.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(bodyParser.json({ limit: BODY_LIMIT }));
app.use(bodyParser.raw({ limit: BODY_LIMIT }));

// Set Maintenance Mode
if (!config.UNDER_MAINTENANCE || config.UNDER_MAINTENANCE == "false") {
    app.use(express.static(path.join(__dirname, './frontend/dist')));
    app.use(express.static(path.join(__dirname, './installation/dist')));
    // RUN FRONTEND SERVER
    app.get("/", (req, res) => {
        res.sendFile(path.join(__dirname, './frontend/dist/index.html'));
    });
} else {
    // RUN UNDER MAINTENANCE SERVER
    app.get("/", (req, res) => {
        res.sendFile(path.join(__dirname, './under-maintenance/index.html'));
    });

    app.use(express.static(path.join(__dirname, 'under-maintenance')));
    app.use(express.static(path.join(__dirname, 'log')));
    app.use((req, res, next) => {
        if (req.path === "/api/v1/finalupgradeprocess"
            || req.path.indexOf("/api/v1/upgradeProcess/events") !== -1
            || req.path.indexOf("/api/v1/realLog/events") !== -1
        ) {
            return next(); // Continue to the next middleware or route handler
        }
        res.sendFile(path.join(__dirname, './under-maintenance/index.html'));
    })
}

// ADD DEFAULT BRAND SETTINGS
makeDefaultBrandSettings()
.catch((error) => {
    console.log("makeDefaultBrandSettings: ", error);
});

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

function initializeControllers() {
    const envFile = fs.readFileSync(__dirname + "/.env");
    const envConfig = require('dotenv').parse(envFile);
    envConfig.PORT = Number(envConfig.PORT);
    envConfig.NOOFPRESETCOMPANY = Number(envConfig.NOOFPRESETCOMPANY);
    const tmpStorage = envConfig.STORAGE_TYPE;
    if (!tmpStorage) {
        envConfig.STORAGE_TYPE = "wasabi";
    }
    for (const key in envConfig) {
        process.env[key] = envConfig[key];
        if (key === "APIKEY" || key === "AUTODOMAIN" || key === "PROJECTID" || key === "STORAGEBUCKET" || key === "MESSAGINGSENDERID" || key === "APPID" || key === "MEASUREMENTID") {
            config["FIREBASE_"+key] = envConfig[key];
        } else {
            config[key] = envConfig[key];
            if (key === "WASABI_ACCESS_KEY") {
                awsRef.wasabiAccessKey = envConfig["WASABI_ACCESS_KEY"];
            } else if (key === "WASABI_SECRET_ACCESS_KEY") {
                awsRef.wasabiSecretAccessKey = envConfig["WASABI_SECRET_ACCESS_KEY"];
            } else if (key === "WASABIENDPOINT") {
                awsRef.wasabiEndPoint = envConfig["WASABIENDPOINT"];
            } else if (key === "WASABI_REGION") {
                awsRef.region = envConfig["WASABI_REGION"];
            } else if (key === "IAM_ENDPOINT") {
                awsRef.iamEndPoint = envConfig["IAM_ENDPOINT"];
            } else if (key === "USERPROFILEBUCKET") {
                awsRef.userProfileBucket = envConfig["USERPROFILEBUCKET"];
            } else if (key === "WASABI_USERID") {
                awsRef.wasabiUserId = envConfig["WASABI_USERID"];
            }
        }
    }
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
    require('./Modules/Scim/init').init(app);
    require('./Modules/Pto/init').init(app);
    require('./Modules/Portfolio/init').init(app);
    require('./Modules/CustomReports/init').init(app);
    require('./Modules/VarianceReport/init').init(app);
    require('./Modules/CapacityPlanning/init').init(app);
    require('./Modules/ScheduledReports/init').init(app);
    require('./Modules/EmailIn/init').init(app);
    require('./Modules/Calendar/init').init(app);
    require('./Modules/Automations/init').init(app);
    require('./Modules/Integrations/init').init(app);
    require('./Modules/notification1/init').init(app);
    require('./Modules/ImportSettings/init').init(app);
    require('./Modules/Tasks/init.js').init(app);
    require('./Modules/Sprints/init.js').init(app);
    require('./Modules/AgileReports/init').init(app);
    require('./Modules/Export/init').init(app);
    require('./Modules/RecurringTasks/init').init(app);
    require('./Modules/Reminders/init').init(app);
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
    require('./Modules/SaasAdmin/init').init(app);
    require('./Modules/ScreenshotRetention/init').init(app);
    require('./Modules/projectClose/init').init(app);
    if(process.env.NODE_ENV === "production") {
        require('./cron.js')
    }
    require('./Modules/Admin/admin.js').init(app);
    require('./Modules/emailTemplate/init').init(app);
    require('./Modules/EmailNotification/init').init(app);
    require(`./Modules/storage/${currentDirectory}/init`).init(app);
    require('./Modules/AI/init').init(app);
    require('./Modules/AIProjectGenerator/init').init(app);
    require('./Modules/Users/init').init(app);
    require('./Modules/Project/init').init(app);
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

//CONFIGURE ENV FILE
require('dotenv').config();
if (process.env.MONGODB_URL) {
    initializeControllers();
}
// if (process.env.CANYONLICENSEKEY) {
//     initializeControllers();
// }

if (!process.env.STORAGE_TYPE) {
    process.env.STORAGE_TYPE = "wasabi";
}

require('./Modules/CheckInstallStep/init').init(app);

// SWAGGER CONFIGURATION
require('./Modules/swaggerAPI/init').init(app, config.APIURL);

// COMMON CODE 
require('./Modules/common/init').init(app);

const { initSocket } = require("./socket/socketinit.js");
//FOR CHECK SERVER RUNNING OR NOT
app.get("/health", (req, res) => {
    res.send("Server is running in "+config.NODE_ENV);
});

fs.watch(__dirname + "/Modules/Template/", (event_type, file_name) => {
    try {
        delete require.cache[require.resolve(__dirname + "/Modules/Template/" + file_name)];;
    } catch (error) {
        console.error("ERROR in remove cache", error);
    }
});

// SERVER LISTEN PORT
const server = app.listen(config.PORT, () => {
    console.log("Server ready on "+config.PORT)
});
initSocket(server);
