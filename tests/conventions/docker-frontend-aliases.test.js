const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const sharedModules = () => [...read('frontend/vue.config.js').matchAll(/path\.resolve\(__dirname,\s*'\.\.\/([^']+)'\)/g)].map((match) => match[1]);

const frontendStage = () => {
    const dockerfile = read('Dockerfile');
    const start = dockerfile.indexOf('AS frontend-builder');
    const end = dockerfile.indexOf('\nFROM ', start);
    return dockerfile.slice(start, end === -1 ? undefined : end);
};

describe('the release image builds the frontend', () => {
    it('finds the backend modules vue.config.js aliases', () => {
        expect(sharedModules().length).toBeGreaterThan(0);
    });

    it.each(sharedModules())('copies %s into the frontend stage', (file) => {
        expect(frontendStage()).toContain(`COPY ${file} /app/${file}`);
    });
});
