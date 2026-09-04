import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';

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

export default defineConfig({
    plugins: [requireAssetsAsUrls, vue()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@pageContent': path.resolve(__dirname, '../Modules/Pages/helpers/pageContent.js')
        }
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['tests/**/*.spec.js'],
        setupFiles: ['tests/setup.js'],
        clearMocks: true
    }
});
