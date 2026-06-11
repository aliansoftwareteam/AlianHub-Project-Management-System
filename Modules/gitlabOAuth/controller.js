const axios = require('axios');
const logger = require("../../Config/loggerConfig");

// GitLab OAuth credentials. GITLAB_BASE_OAUTH_URL points at the OAuth base
// (e.g. https://gitlab.com/oauth) so the token endpoint is `${base}/token`.
// Self-managed GitLab is supported by changing the host in these vars.
const CLIENT_ID = process.env.GITLAB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITLAB_CLIENT_SECRET;
const GITLAB_BASE_OAUTH_URL = process.env.GITLAB_BASE_OAUTH_URL || 'https://gitlab.com/oauth';

/**
 * Exchange the authorization code for an access token.
 *
 * Unlike GitHub, GitLab requires `grant_type` and the exact `redirect_uri`
 * that started the flow, so the client forwards the redirect URI it used.
 */
exports.getAccessToken = async (req, res) => {
    try {
        const { code, redirectUri } = req.body;

        if (!code) {
            return res.send({ status: false, statusText: "Missing authorization code" });
        }

        const tokenResponse = await axios.post(`${GITLAB_BASE_OAUTH_URL}/token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
        }, { headers: { Accept: "application/json" } });

        const accessToken = tokenResponse.data.access_token;

        res.send({ status: true, accessToken });
    } catch (error) {
        logger.error("Error in gitlab getAccessToken hook:", error?.response?.data || error.message);
        return res.send({
            status: false,
            statusText: "Error in gitlab getAccessToken hook:",
            error: error.message,
        });
    }
};
