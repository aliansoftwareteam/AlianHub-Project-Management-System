const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { importRestrictedExtensions, importCustomFields, importTours } = require("../../utils/data");
const { uploadPublicAssets } = require('../storage/wasabi/controller');
const logger = require('../../Config/loggerConfig.js');

exports.startInitialization = () => {
    return new Promise((resolve, reject) => {
        try {
            const promises = [];

            promises.push(
                // ADD RESTRICTED EXTENSIONS
                importRestrictedExtensions(SCHEMA_TYPE.GOLBAL)
            )
            promises.push(
                // ADD customField
                importCustomFields(SCHEMA_TYPE.GOLBAL)
            )
            promises.push(
                // ADD Project Tour
                importTours(SCHEMA_TYPE.GOLBAL)
            )

            promises.push(
                // Upload public assets
                uploadPublicAssets()
            )

            Promise.allSettled(promises)
            .then((result) => {
                logger.info(`initialization result: ${JSON.stringify(result.map(r => r.status))}`);
                resolve();
            })
            .catch((error) => {
                reject(error);
            })
        } catch (error) {
            reject(error);
        }
    });
};
