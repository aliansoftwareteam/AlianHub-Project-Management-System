import { apiRequestWithoutCompnay, apiRequestWithoutSecure } from "@/services";
import * as env from '@/config/env';
import { applyPublicConfig } from '@/config/publicConfig';

export const setPublicConfig = ({ commit }) => apiRequestWithoutSecure('get', env.INSTANCE_PUBLIC_CONFIG)
    .then((response) => {
        const data = response?.data?.data || {};
        commit('mutatePublicConfig', data);
        applyPublicConfig(data);
        return data;
    })
    .catch((error) => {
        console.error('ERROR in set public config', error);
        return {};
    });

export const setBrandSettings = ({commit}) => {
    return new Promise((resolve, reject) => {
        try {
            apiRequestWithoutCompnay('get',env.GET_BRAND_SETTINGS_INFORMATION).then((response) => {
                if(response.status === 200) {
                    commit('mutateBrandSettings', response);
                    resolve(response);
                } else {
                    commit('mutateBrandSettings', {})
                    resolve({});
                }
            }).catch((err) => {
                commit('mutateBrandSettings', {})
                reject(err);
                console.error(err);
            })
        } catch (error) {
            reject(error);
        }
    });
}