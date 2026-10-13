import { defineAsyncComponent } from 'vue';

const PRO_KEY = 'fk-12603cbaaf0';

let app = null;
let installed = null;

export const bindFormKitApp = (instance) => {
    app = instance;
    installed = null;
};

/* Only the field components draw with FormKit, so the library and its plugin are installed on the
 * running app the first time one of them renders. Installing after mount works because what the
 * plugin provides is read from the app when a FormKit input is created, not when the app starts.
 * Without a bound app (a spec that installs FormKit itself) only the library is loaded. */
export const ensureFormKit = () => {
    if (!installed) {
        installed = Promise.all([
            import(/* webpackChunkName: "formkit" */ '@formkit/vue'),
            import(/* webpackChunkName: "formkit" */ '@formkit/pro')
        ]).then(([library, pro]) => {
            if (app) app.use(library.plugin, library.defaultConfig({ plugins: [pro.createProPlugin(PRO_KEY, pro.inputs)] }));
            return library;
        }).catch((error) => {
            installed = null;
            throw error;
        });
    }
    return installed;
};

export const FormKit = defineAsyncComponent(() => ensureFormKit().then((library) => library.FormKit));
