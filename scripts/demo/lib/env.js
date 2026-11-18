const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// Config/config.js looks for .env next to require.main, which is scripts/demo for these entry points.
require('dotenv').config({ path: path.join(ROOT, '.env') });

module.exports = { ROOT, ACCOUNTS_PATH: path.join(ROOT, '.demo-accounts.local.json') };
