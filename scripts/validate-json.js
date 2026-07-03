/**
 * Validates that every file passed as an argument parses as JSON.
 * Used by lint-staged (see lint-staged.config.js) so a broken
 * utils/cardComponent.json or dashboardTemplate.json can't be committed.
 */
const fs = require('fs');

let ok = true;
for (const file of process.argv.slice(2)) {
    try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error(`Invalid JSON: ${file}\n  ${e.message}`);
        ok = false;
    }
}
process.exit(ok ? 0 : 1);
