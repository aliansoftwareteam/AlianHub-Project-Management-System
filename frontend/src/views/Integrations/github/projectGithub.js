import { reactive } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

/* One read per project, shared by the header chip and the project's GitHub card, so a change on the card shows in the chip. */
const views = reactive({});

export const projectGithubView = (projectId) => views[projectId] || null;

export const hasProjectGithubView = (projectId) => Object.prototype.hasOwnProperty.call(views, projectId);

export const loadProjectGithub = async (projectId) => {
    try {
        const res = await apiRequest("get", `${env.INTEGRATIONS}/github/projects/${projectId}`);
        views[projectId] = res?.data?.status ? res.data.data : null;
    } catch (e) {
        views[projectId] = null;
    }
    return views[projectId];
};
