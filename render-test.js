/**
 * render-test.js — minimal startup diagnostic
 * Temporarily replace start command with: node render-test.js
 * This isolates whether the problem is in index.js or in Node/Render config
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

console.log('[render-test] Starting minimal test server...');
console.log('[render-test] NODE_ENV:', process.env.NODE_ENV);
console.log('[render-test] PORT:', process.env.PORT);
console.log('[render-test] MONGODB_URL set:', !!process.env.MONGODB_URL);

// Write .env from process.env
const KEYS = ['PORT','NODE_ENV','APP_NAME','MONGODB_URL','JWT_SECRET','JWT_EXP',
  'JWT_ALGORITHM','APIURL','WEBURL','STORAGE_TYPE','UNDER_MAINTENANCE',
  'NOOFPRESETCOMPANY','PRECOMPANYKEY','ERRORRECIVEREMAIL',
  'NODEMAILER_HOST','NODEMAILER_PORT','NODEMAILER_EMAIL','NODEMAILER_EMAIL_PASSWORD'];
const lines = KEYS.filter(k => process.env[k] !== undefined).map(k => `${k}="${process.env[k]}"`);
fs.writeFileSync(path.join(__dirname, '.env'), lines.join('\n'));
console.log('[render-test] Wrote .env with', lines.length, 'keys');

const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV, port: process.env.PORT });
});

app.get('/', (req, res) => {
  res.send('Render test server is alive! Next step: switch back to full app.');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('[render-test] Listening on port', PORT);
});
