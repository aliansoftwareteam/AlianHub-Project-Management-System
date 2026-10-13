import { defineConfig, configDefaults } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import { createRequire } from 'module';

// Components load images with webpack's `require("@/assets/...")`, which Node's
// require cannot resolve; under test the asset path itself is a fine value.
const requireAssetsAsUrls = {
    name: 'require-assets-as-urls',
    enforce: 'pre',
    transform(code, id) {
        if (id.includes('node_modules') || !/\.(vue|js)(\?.*)?$/.test(id)) return null;
        if (!code.includes('require(')) return null;
        return code.replace(/require\((['"])(@\/assets\/[^'"]+)\1\)/g, '$1$2$1');
    }
};

const require = createRequire(import.meta.url);
const clockSkip = process.env.CLOCK_SHIFT_DAYS ? require('../tests/support/clock-skip').frontend : [];

export default defineConfig({
    plugins: [requireAssetsAsUrls, vue()],
    resolve: {
        // vue-cli (webpack) resolves extensionless `.vue` imports; Vite does not by default.
        extensions: ['.mjs', '.js', '.json', '.vue'],
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@pageContent': path.resolve(__dirname, '../Modules/Pages/helpers/pageContent.js'),
            '@agentWork': path.resolve(__dirname, '../Modules/Agents/workKinds.js'),
            '@egressRules': path.resolve(__dirname, '../Modules/Agents/engine/egressRules.js'),
            '@agentDailyRunLimit': path.resolve(__dirname, '../Modules/Agents/dailyRunLimit.js'),
            '@passwordRule': path.resolve(__dirname, '../Modules/Auth/helpers/passwordRule.js'),
            '@viewSettings': path.resolve(__dirname, '../Modules/Project/helpers/viewSettings.js'),
            '@fieldTaskTypes': path.resolve(__dirname, '../Modules/CustomField/helpers/fieldTaskTypes.js'),
            '@datePastFuture': path.resolve(__dirname, '../Modules/CustomField/helpers/datePastFuture.js'),
            '@fieldTypes': path.resolve(__dirname, '../Modules/CustomField/fieldTypes'),
            '@automationTemplates': path.resolve(__dirname, '../Modules/Automations/templates.js'),
            '@workingDays': path.resolve(__dirname, '../Modules/Company/helpers/workingDays.js'),
            '@ganttShift': path.resolve(__dirname, '../Modules/Tasks/helpers/ganttShift.js'),
            '@taskTreeRules': path.resolve(__dirname, '../Modules/Tasks/helpers/taskTreeRules.js'),
            '@taskExtraListsRules': path.resolve(__dirname, '../Modules/Tasks/helpers/taskExtraListsRules.js'),
            '@descriptionBlock': path.resolve(__dirname, '../Modules/Tasks/helpers/descriptionBlock.js'),
            '@richTextAllowlist': path.resolve(__dirname, '../Modules/Tasks/helpers/richTextAllowlist.js'),
            '@formLogic': path.resolve(__dirname, '../Modules/Forms/helpers/formLogic.js')
        }
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['tests/**/*.spec.js'],
        exclude: [...configDefaults.exclude, ...clockSkip],
        setupFiles: ['tests/shift-clock.setup.js', 'tests/setup.js'],
        clearMocks: true
    }
});
