import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

vi.unmock('@/plugins/customFieldView/lazyFormKit');
vi.unmock('@/plugins/customFieldView/customFieldPlugin');

const { createProPlugin } = vi.hoisted(() => ({ createProPlugin: vi.fn(() => () => {}) }));
vi.mock('@formkit/pro', () => ({ createProPlugin, inputs: { marker: 'pro inputs' } }));

import { LAZY_GLOBAL_LOADERS, registerLazyGlobals } from '@/config/lazyGlobals';
import customFieldPlugin, { CUSTOM_FIELD_LOADERS } from '@/plugins/customFieldView/customFieldPlugin';
import dashboardPlugin from '@/plugins/dashboard/dashboardPlugin';
import tasklistDashboardPlugin from '@/plugins/tasklistDashboard/tasklistDashboardPlugin';
import importTasksPlugin from '@/plugins/importTasks/importTasksPlugin';
import importUsersPlugin from '@/plugins/importUsers/importUsersPlugin';
import { FormKit, bindFormKitApp } from '@/plugins/customFieldView/lazyFormKit';

const require = createRequire(import.meta.url);
const FRONTEND = path.resolve(__dirname, '../..');
const SRC = path.join(FRONTEND, 'src');

/* What index.html makes the browser fetch before anything is drawn is the entry and whatever it
 * imports with a plain `import`; a dynamic import() starts a chunk of its own. This walks the plain
 * imports from main.js the way webpack does. */
const EXTENSIONS = ['', '.js', '.vue', '.ts', '.json', '/index.js', '/index.vue', '/index.ts'];
const STYLE_REQUEST = /\.(css|scss)$|\/genesis$/;
const IMPORT = /^[ \t]*import\s+(?:[^'"()]*?\sfrom\s*)?['"]([^'"]+)['"]/gm;
const EXPORT_FROM = /^[ \t]*export\s+[^'"()]*?\sfrom\s*['"]([^'"]+)['"]/gm;
const REQUIRE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

const resolveFile = (base) => EXTENSIONS.map((ext) => base + ext).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
const resolveRequest = (request, from) => {
    if (request.startsWith('@/')) return resolveFile(path.join(SRC, request.slice(2)));
    if (request.startsWith('.')) return resolveFile(path.resolve(path.dirname(from), request));
    return null;
};
const packageOf = (request) => request.split('/').slice(0, request.startsWith('@') ? 2 : 1).join('/');

function firstPaintGraph() {
    const files = new Set([path.join(SRC, 'main.js')]);
    const packages = new Set();
    const queue = [...files];
    while (queue.length) {
        const file = queue.shift();
        if (!/\.(js|ts|vue)$/.test(file)) continue;
        const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        [IMPORT, EXPORT_FROM, REQUIRE].forEach((pattern) => {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(text))) {
                const request = match[1];
                const resolved = resolveRequest(request, file);
                if (resolved) {
                    if (!files.has(resolved)) { files.add(resolved); queue.push(resolved); }
                } else if (!request.startsWith('.') && !request.startsWith('@/') && !STYLE_REQUEST.test(request)) {
                    packages.add(packageOf(request));
                }
            }
        });
    }
    return { files: [...files].map((file) => path.relative(SRC, file)), packages: [...packages] };
}

describe('what the first paint downloads', () => {
    const graph = firstPaintGraph();

    it('still starts from the shell, the router, the store and the task panel host', () => {
        ['App.vue', 'router/index.js', 'store/index.js', 'locales/en.js', 'components/organisms/TaskDetailOverlay/TaskDetailOverlay.vue']
            .forEach((file) => expect(graph.files).toContain(file));
    });

    it('leaves out the libraries only some screens draw with', () => {
        const SCREEN_ONLY = [
            'apexcharts', 'vue3-apexcharts', 'xlsx', 'jszip', 'grid-layout-plus', 'v-calendar', '@vuepic/vue-datepicker',
            '@formkit/vue', '@formkit/pro', '@formkit/core', 'mic-recorder-to-mp3', 'detectrtc', 'markdown-it', 'vuedraggable',
            'vue3-timepicker', 'country-state-city', 'dompurify'
        ];
        const reached = graph.packages.filter((name) => SCREEN_ONLY.includes(name) || name.startsWith('@editorjs/'));
        expect(reached).toEqual([]);
    });

    it('leaves out the task panel, the plugin screens and the data only one field needs', () => {
        const LAZY = [
            'components/organisms/TaskDetailOverlay/TaskDetailPanel.vue',
            'components/atom/Description/Description.vue',
            'views/Projects/Comments/Comments.vue',
            'plugins/customFieldView/component/molecules/customFieldTaskView/customFieldRender.vue',
            'plugins/customFieldView/component/molecules/customFieldViewColumn/customFieldListViewColumn.vue',
            'plugins/dashboard/component/CalendarComponent.vue',
            'plugins/dashboard/component/QueueListComponent.vue',
            'plugins/tasklistDashboard/views/DashBoardList/DashBoardList.vue',
            'plugins/importTasks/components/templates/ImportTaskButton.vue',
            'plugins/importUsers/components/templates/ImportUsers.vue',
            'components/atom/FormkitInput/InputField.vue',
            'components/molecules/PhoneComponent/allCountry.js'
        ];
        LAZY.forEach((file) => expect(fs.existsSync(path.join(SRC, file)), file).toBe(true));
        expect(graph.files.filter((file) => LAZY.includes(file))).toEqual([]);
        expect(graph.files.filter((file) => /^locales\/(?!en\.js|main\.js)/.test(file))).toEqual([]);
    });

    it('has no route table that imports a page with a plain import', () => {
        const tables = graph.files.filter((file) => /^router\//.test(file) || /^plugins\/[^/]+\/router\.js$/.test(file));
        expect(tables.length).toBeGreaterThan(20);
        const eager = tables.filter((file) => /^[ \t]*import\s[^'"()]*from\s*['"][^'"]+\.vue['"]/m.test(fs.readFileSync(path.join(SRC, file), 'utf8')));
        expect(eager).toEqual([]);
    });
});

describe('the first-paint budget', () => {
    const { FIRST_PAINT_BUDGET_BYTES } = require('../../firstPaintBudget.js');
    const config = require('../../vue.config.js');
    const source = fs.readFileSync(path.join(FRONTEND, 'vue.config.js'), 'utf8');

    it('is one number, and the build is told to fail above it', () => {
        expect(Number.isInteger(FIRST_PAINT_BUDGET_BYTES) && FIRST_PAINT_BUDGET_BYTES > 0).toBe(true);
        expect(config.configureWebpack.performance.maxEntrypointSize).toBe(FIRST_PAINT_BUDGET_BYTES);
        expect(source).toMatch(/hints:\s*process\.env\.NODE_ENV === 'production' \? 'error' : false/);
        expect(source).not.toMatch(/maxEntrypointSize:\s*\d/);
    });

    it('is the number the performance document quotes', () => {
        const doc = fs.readFileSync(path.resolve(FRONTEND, '../docs/PERFORMANCE.md'), 'utf8');
        expect(doc).toContain(FIRST_PAINT_BUDGET_BYTES.toLocaleString('en-US'));
    });

    it('keeps the date library\'s unused languages out of the build', () => {
        const ignore = config.configureWebpack.plugins.find((plugin) => plugin.constructor.name === 'IgnorePlugin');
        expect(ignore.options.resourceRegExp.test('./locale')).toBe(true);
        expect(ignore.options.contextRegExp.test('/node_modules/moment')).toBe(true);
    });
});

describe('the libraries registered by name', () => {
    it('keeps the four global names', () => {
        expect(Object.keys(LAZY_GLOBAL_LOADERS)).toEqual(['ApexChart', 'VDatePicker', 'GridLayout', 'GridItem']);
    });

    it('fetches a library when a screen first renders it, once, and hands it the screen\'s props, slot and ref', async () => {
        const Chart = defineComponent({
            props: ['type'],
            setup(props, { slots, expose }) {
                expose({ dataURI: () => 'image' });
                return () => h('figure', { class: `chart chart--${props.type}` }, slots.default && slots.default());
            }
        });
        const loader = vi.fn(() => Promise.resolve({ default: Chart, __esModule: true }));
        const Screen = defineComponent({ template: '<section><ApexChart ref="chart" type="line">caption</ApexChart><ApexChart type="area" /></section>' });
        const lazyGlobals = { install: (app) => registerLazyGlobals(app, { ApexChart: loader }) };

        expect(loader).not.toHaveBeenCalled();
        const screen = mount(Screen, { global: { plugins: [lazyGlobals] } });
        expect(screen.find('.chart').exists()).toBe(false);
        await flushPromises();

        expect(screen.find('.chart--line').text()).toBe('caption');
        expect(screen.find('.chart--area').exists()).toBe(true);
        expect(screen.vm.$refs.chart.dataURI()).toBe('image');
        expect(loader).toHaveBeenCalledTimes(1);
        screen.unmount();
    });
});

describe('the plugins', () => {
    const installed = (plugin) => {
        const app = { components: {}, provided: {}, component(name, value) { this.components[name] = value; }, provide(name, value) { this.provided[name] = value; } };
        plugin.install(app);
        return app;
    };
    const isLazy = (component) => typeof component.__asyncLoader === 'function';

    it('register every field component under its name, each fetched on first use from one chunk', () => {
        const app = installed(customFieldPlugin);
        expect(Object.keys(app.components)).toEqual([
            'CustomFieldRenderViewComponent', 'CustomFieldSidebarComponent', 'SettingCustomFieldViewComponent', 'CustomFieldListViewColumnComponent',
            'CustomFieldProjectComponent', 'CustomFieldProjectDetailView', 'CustomFieldsSidebarComponent'
        ]);
        expect(Object.values(app.components).every(isLazy)).toBe(true);
        expect(Object.keys(CUSTOM_FIELD_LOADERS)).toEqual(Object.keys(app.components));
        const plugin = fs.readFileSync(path.join(SRC, 'plugins/customFieldView/customFieldPlugin.js'), 'utf8');
        expect(plugin.match(/webpackChunkName: "custom-fields"/g)).toHaveLength(7);
    });

    it('register the dashboard cards lazily and provide the very components they register', () => {
        const cards = installed(dashboardPlugin);
        expect(Object.keys(cards.components)).toEqual(['CalendarComponent', 'CalendarTaskDisplayComponent', 'DisplayComponent', 'MainLabledComponent', 'QueueListComponent', 'SingleQueueListComponent']);
        expect(Object.values(cards.components).every(isLazy)).toBe(true);
        expect(Object.keys(cards.provided)).toEqual(['CalendarComponent', 'QueueListComponent']);
        expect(cards.provided.CalendarComponent).toBe(cards.components.CalendarComponent);
        expect(cards.provided.QueueListComponent).toBe(cards.components.QueueListComponent);

        const list = installed(tasklistDashboardPlugin);
        expect(isLazy(list.components.DashBoardList)).toBe(true);
        expect(list.provided.DashBoardList).toBe(list.components.DashBoardList);
    });

    it('register the two import screens lazily', () => {
        expect(isLazy(installed(importTasksPlugin).components.ImportTaskButton)).toBe(true);
        expect(isLazy(installed(importUsersPlugin).components.ImportUsers)).toBe(true);
    });

    it('read a spreadsheet with a reader fetched when a file is picked', () => {
        ['plugins/importTasks/components/organisms/ImportWizard/ImportWizard.vue', 'plugins/importTasks/components/atoms/ImportCsv.vue'].forEach((file) => {
            const text = fs.readFileSync(path.join(SRC, file), 'utf8');
            expect(text).not.toMatch(/from\s+['"]xlsx['"]/);
            expect(text).toMatch(/const XLSX = await loadXlsx\(\)/);
        });
    });
});

describe('FormKit, installed when a field first draws with it', () => {
    it('is absent at start, then installed on the running app with the Pro inputs, and draws the input', async () => {
        const Field = defineComponent({ render: () => h('div', { class: 'field' }, [h(FormKit, { type: 'text', name: 'title', label: 'Title' })]) });
        const host = document.createElement('div');
        const app = createApp(Field);
        bindFormKitApp(app);
        app.mount(host);

        expect(app.config.globalProperties.$formkit).toBeUndefined();
        expect(host.querySelector('input')).toBeNull();

        await vi.dynamicImportSettled();
        await flushPromises();
        await nextTick();

        expect(app.config.globalProperties.$formkit).toBeDefined();
        expect(createProPlugin).toHaveBeenCalledTimes(1);
        expect(createProPlugin.mock.calls[0][1]).toEqual({ marker: 'pro inputs' });
        expect(host.querySelector('input[name="title"]')).not.toBeNull();
        expect(host.textContent).toContain('Title');
        app.unmount();
    });
});

describe('warming the workspace chunks', () => {
    let warmWorkspaceChunks;

    beforeEach(async () => {
        vi.resetModules();
        vi.useFakeTimers();
        delete window.requestIdleCallback;
        ({ warmWorkspaceChunks } = await import('@/config/warmChunks'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('waits for a quiet moment, fetches each chunk once, and shrugs off a failed fetch', async () => {
        const panel = vi.fn(() => Promise.resolve({}));
        const fields = vi.fn(() => Promise.reject(new Error('ChunkLoadError: Loading chunk custom-fields failed')));

        warmWorkspaceChunks([panel, fields]);
        expect(panel).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2000);
        expect(panel).toHaveBeenCalledTimes(1);
        expect(fields).toHaveBeenCalledTimes(1);

        warmWorkspaceChunks([panel, fields]);
        await vi.advanceTimersByTimeAsync(10000);
        expect(panel).toHaveBeenCalledTimes(1);
    });

    it('uses the browser\'s idle callback where there is one', () => {
        window.requestIdleCallback = vi.fn();
        warmWorkspaceChunks([vi.fn()]);
        expect(window.requestIdleCallback).toHaveBeenCalledTimes(1);
        delete window.requestIdleCallback;
    });
});
