const logger = require("../../Config/loggerConfig");
const { updateEnvVariablesUtil, getEnvVariablesUtil } = require("../../utils/envUpdater");

/**
 * Get OAuth credentails
 */
exports.getOAuthCred = async (req, res) => {
    try {
        // Use our new utility to fetch all frontend env variables
        // If need specific variable value then call like - await getEnvVariablesUtil("frontend", "VUE_APP_GOOGLE_CLIENT_ID")
        const envVars = await getEnvVariablesUtil("frontend");
        const backendEnvVars = await getEnvVariablesUtil("root");

        return res.json({
            status: true,
            data: {
                clientId: backendEnvVars.GOOGLE_CLIENT_ID || "",
                clientSecret: backendEnvVars.GOOGLE_CLIENT_SECRET || "",
                isGoogleLogin: envVars.VUE_APP_IS_GOOGLE_LOGIN === "true",
                githubClientId: backendEnvVars.GITHUB_CLIENT_ID || '',
                githubClientSecret: backendEnvVars.GITHUB_CLIENT_SECRET || '',
                isGithubLogin: envVars.VUE_APP_IS_GITHUB_LOGIN === "true",
            },
        });
    } catch (error) {
        logger.error("Error reading .env file in getOAuthCred:", error);
        return res.status(500).json({
            status: false,
            statusText: "Failed to read .env file",
            error: error.message,
        });
    }
};

/**
 * Update OAuth credentails
 */
exports.updateOAuthCred = (req, res) => {
    try {
        const { pathType, variables } = req.body;
        const message = updateEnvVariablesUtil(pathType, variables);
        res.json({ status: true, statusText: message });
    } catch (error) {
        logger.error("Unexpected error in updateOAuthCred:", error);
        res.status(500).json({
            status: false,
            statusText: "Unexpected server error",
            error: error.message,
        });
    }
};
