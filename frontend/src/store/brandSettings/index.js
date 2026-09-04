import * as actions from "./actions.js";
import * as mutations from './mutations.js';
export default {
    namespaced: true,
    state: {
        brandSettings: {},
        publicConfig: {}
    },
    getters: {
        brandSettings: state => state.brandSettings,
        publicConfig: state => state.publicConfig,
    },
    mutations: mutations,
    actions: actions
}