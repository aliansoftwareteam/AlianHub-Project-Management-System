import { config } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { ref } from 'vue';
import { vi } from 'vitest';

vi.mock('vue-toast-notification', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() })
}));

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
