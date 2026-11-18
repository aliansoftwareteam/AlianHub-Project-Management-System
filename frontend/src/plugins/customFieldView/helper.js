import * as env from '@/config/env';
import { apiRequest } from "@/services";
export function customField() {
    // SettingsShell renders this list as the plugin-contributed settings tabs.
    function tabRouteHelper(){
        return [{
            label: "Custom Field Manager",
            to: { name: "Custom-Fields" },
            icon: require("@/assets/images/svg/WorkspaceSettingsInactive.svg"),
            isVisible: true,
            permissions: ['settings.settings_custom_field'],
            activeIcon: require("@/assets/images/svg/WorkspaceSettings.svg")
        },{
            label: "Language & Region",
            to: { name: "LanguageRegion" },
            icon: require("@/assets/images/svg/WorkspaceSettingsInactive.svg"),
            isVisible: true,
            activeIcon: require("@/assets/images/svg/WorkspaceSettings.svg")
        }];
    }
    function projectAlianApp(){
        return [''];
    }
    function setfinalCustomFieldsArray ({commit}) {
        return new Promise((resolve, reject) => {
            try {
                apiRequest("get",`${env.CUSTOM_FIELD}?global=false`).then((res) => {
                    if(res.status === 200 && res?.data && res.data.length){
                        res.data.forEach((e) => {
                            if(e.projectId && typeof e.projectId === 'string'){
                                e.projectId = [e.projectId]
                            }
                            if(!(e?.type)){
                                e.type = 'task'
                            }
                        })
                        commit("mutateFinalCustomFields", {
                            data: res.data || [],
                            op: "inital",
                        });
                        resolve(res.data)
                    }else{
                        commit("mutateFinalCustomFields", {
                            data: [],
                            op: "inital",
                        });
                        resolve([])
                    }
                })
                .catch((error) => {
                    reject(error)
                })
            } catch (error) {
                reject(error);
            }
    
        })
    }
    function setCustomFieldsArray ({commit}) {
        return new Promise((resolve, reject) => {
            try {
                apiRequest("get",`${env.CUSTOM_FIELD}?global=true`).then((res) => {
                    if(res.status === 200 && res?.data && res.data.length){
                        commit("mutateCustomFields", res.data)
                        resolve(res.data);
                    }else{
                        commit("mutateCustomFields", [])
                        resolve([]);
                    }
                })
                .catch((error) => {
                    reject(error);
                    console.error("ERROR in get Customfields: ", error);
                })
            } catch (error) {
                reject(error);
            }
    
        })
    }
    function isCustomFields() {
        return true;
    }
    return {
        tabRouteHelper,
        projectAlianApp,
        setfinalCustomFieldsArray,
        setCustomFieldsArray,
        isCustomFields
    }
}