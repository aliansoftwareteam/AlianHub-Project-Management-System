const express = require("express");
const fs = require("fs");
var cors = require('cors');
const path = require('path');

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
// CORS — BUG-002 / #56. Replace wildcard with an env-driven allow-list.
// See utils/cors.js for the exact rules and supported env vars.
app.use(cors({ origin: corsOriginDelegate }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.raw({limit: '50mb'}));

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
    require('./Modules/notification1/init').init(app);
    require('./Modules/ImportSettings/init').init(app);
    require('./Modules/Tasks/init.js').init(app);
    require('./Modules/Sprints/init.js').init(app);
    require('./Modules/LogTime/init.js').init(app);
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
    require('./Modules/CheckInstallStep/init').init(app);
    require('./Modules/SaasAdmin/init').init(app);
    if(process.env.NODE_ENV === "production") {
        require('./cron.js')
    }
    require('./Modules/Admin/admin.js').init(app);
    require('./Modules/emailTemplate/init').init(app);
    require('./Modules/EmailNotification/init').init(app);
    require(`./Modules/storage/${currentDirectory}/init`).init(app);
    require('./Modules/AI/init').init(app);
    require('./Modules/Users/init').init(app);
    require('./Modules/Project/init').init(app);
    require('./Modules/Teams/init').init(app);
    require('./Modules/tours/init').init(app);
    require('./Modules/AdvancedGlobalFilter/init.js').init(app);
    require('./Modules/settings/settingCurrency/init').init(app);
    require('./Modules/settings/settingNotifications/init').init(app);
    require('./Modules/projectRules/init').init(app);
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
}

// FIRES EVENT WHEN THE ENV IS UPDATED
fs.watchFile(__dirname+'/.env', () => {
    initializeControllers();
})

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
