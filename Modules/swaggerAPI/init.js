let swaggerJsdoc = require("swagger-jsdoc");
let swaggerUi = require("swagger-ui-express");


/**
 * Swagger API document configuration
 * @param {*} app 
 */
exports.init = (app, apiUrl) => {
    const swaggerOptions = {
        definition: {
            openapi: "3.0.0",
            info: {
                title: "AlianHub APIs",
                version: "v1"
            },
            servers: [
                {
                    url: apiUrl,
                },
            ],
        },
        apis: [
            "./Modules/Auth/routes.js",
            "./Modules/Auth/routes2.js",
            "./Modules/notification1/routes.js",
            "./Modules/import_settings1/routes.js",
            "./Modules/remove-sprint-operations/routes.js",
            "./Modules/logTime/routes.js",
            "./Modules/milestone/routes.js",
            "./Modules/wasabi/routes.js",
            "./Modules/Company/routes.js",
            './Modules/notification/prepare-notification-data/routes.js',
            "./Modules/notification/notification-middleware/routes.js",
            "./Modules/projectSetting/routes.js",
            "./Modules/trackerDownload/routes.js",
            "./Modules/taskIndex/routes.js",
            "./Modules/createProject/routes.js",
            "./Modules/notification-count/routes.js",
            "./Modules/trackerUserPermission/routes.js",
            "./Modules/Instance/routes.js",
        ]
    };

    const specs = swaggerJsdoc(swaggerOptions);
    app.use(
        "/apidocs",
        swaggerUi.serve,
        swaggerUi.setup(specs)
    );
};
