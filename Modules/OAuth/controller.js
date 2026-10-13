const logger = require("../../Config/loggerConfig");
const { updateEnvVariablesUtil, getEnvVariablesUtil } = require("../../utils/envUpdater");
const { validateOAuthUpdate, maskOAuthCred } = require("./helpers/oauthSettingsRules");

exports.getOAuthCred = async (req, res) => {
    try {
        const frontendEnv = await getEnvVariablesUtil("frontend").catch(() => ({}));
        const backendEnv = await getEnvVariablesUtil("root").catch(() => ({}));
        return res.json({ status: true, statusText: "OK", data: maskOAuthCred(backendEnv, frontendEnv) });
    } catch (error) {
        logger.error(`Error reading .env file in getOAuthCred: ${error.message || error}`);
        return res.status(500).json({ status: false, statusText: "Failed to read OAuth settings", message: "Failed to read OAuth settings" });
    }
};

exports.updateOAuthCred = async (req, res) => {
    try {
        const { pathType, variables } = req.body || {};
        const checked = validateOAuthUpdate(pathType, variables);
        if (!checked.ok) {
            return res.status(400).json({ status: false, statusText: checked.error, message: checked.error });
        }
        const message = await updateEnvVariablesUtil(pathType, checked.variables);
        return res.json({ status: true, statusText: message });
    } catch (error) {
        logger.error(`Unexpected error in updateOAuthCred: ${error.message || error}`);
        return res.status(500).json({ status: false, statusText: "Unexpected server error", message: "Unexpected server error" });
    }
};
