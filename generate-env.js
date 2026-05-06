/**
 * generate-env.js
 * Writes a .env file from Render (or any host) environment variables.
 * Run before starting the app: node generate-env.js && node index.js
 */
const fs = require('fs');
const path = require('path');

const KEYS = [
  'PORT', 'NODE_ENV', 'APP_NAME',
  'MONGODB_URL',
  'JWT_SECRET', 'JWT_EXP', 'JWT_ALGORITHM',
  'APIURL', 'WEBURL',
  'STORAGE_TYPE', 'SERVICE_FILE',
  'UNDER_MAINTENANCE',
  'NOOFPRESETCOMPANY', 'PRECOMPANYKEY',
  'ERRORRECIVEREMAIL',
  'NODEMAILER_HOST', 'NODEMAILER_PORT',
  'NODEMAILER_EMAIL', 'NODEMAILER_EMAIL_PASSWORD',
  'WASABI_SECRET_ACCESS_KEY', 'WASABI_ACCESS_KEY',
  'WASABI_USERID', 'WASABIENDPOINT', 'WASABI_REGION',
  'IAM_ENDPOINT', 'USERPROFILEBUCKET',
  'AI_API_KEY', 'AI_MODEL',
  'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
];

const lines = KEYS
  .filter(k => process.env[k] !== undefined)
  .map(k => `${k}="${process.env[k]}"`);

const envPath = path.join(__dirname, '.env');
fs.writeFileSync(envPath, lines.join('\n'));
console.log(`[generate-env] Wrote .env with ${lines.length} keys`);
