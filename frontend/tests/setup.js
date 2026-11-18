import { config } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { ref } from 'vue';
import { vi } from 'vitest';

vi.mock('vue-toast-notification', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}));

/* In the app FormKit and the field components arrive in chunks of their own. Specs about the fields
 * mount them and read the result at once, so here both are loaded up front; how they are fetched
 * is covered by firstPaintSet.spec.js, which asks for the real modules. */
vi.mock('@/plugins/customFieldView/lazyFormKit', async () => {
    const library = await import('@formkit/vue');
    return { FormKit: library.FormKit, ensureFormKit: () => Promise.resolve(library), bindFormKitApp: () => {} };
});

vi.mock('@/plugins/customFieldView/customFieldPlugin', async (importOriginal) => {
    const original = await importOriginal();
    const loaded = await Promise.all(Object.entries(original.CUSTOM_FIELD_LOADERS).map(async ([name, load]) => [name, (await load()).default]));
    return { ...original, default: { install: (app) => loaded.forEach(([name, component]) => app.component(name, component)) } };
});

window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const i18n = createI18n({ legacy: false, globalInjection: true, locale: 'en', fallbackLocale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false });

config.global.plugins = [i18n];
config.global.mocks = { $t: (key) => key };
config.global.provide = {
    $userId: ref('user-1'),
    $companyId: ref('company-1'),
    $clientWidth: ref(1280),
    $socket: ref({ id: 'sock', on: vi.fn(), off: vi.fn(), emit: vi.fn() })
};
