/* Preloaded into the harness server. The app fills every variable the environment
 * leaves unset from the repository .env, which would hand the suite a developer's
 * mail, AI and OAuth credentials. The server gets exactly the environment server.js builds. */
const dotenv = require('dotenv');

dotenv.config = () => ({ parsed: {} });
dotenv.parse = () => ({});
