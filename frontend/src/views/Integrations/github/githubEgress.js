import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

export const EGRESS_BLOCKED = "egress_blocked";

/* The card only ever offers to allow GitHub's own host; anything else is added on the egress page. */
export const GITHUB_API_HOST = "api.github.com";

export const blockedHostIn = (body) => (body?.code === EGRESS_BLOCKED ? body?.data?.host || "" : "");

export const isInstanceOwner = async () => {
    try {
        const res = await apiRequestWithoutCompnay("get", env.INSTANCE_ACCESS);
        return res?.data?.data?.allowed === true;
    } catch (e) {
        return false;
    }
};

/* Adds the one host to this workspace's list, sending the version read so a list changed meanwhile is not overwritten. */
export const allowHost = async (companyId, host) => {
    const read = await apiRequestWithoutCompnay("get", `${env.INSTANCE_EGRESS}?workspace=${companyId}`);
    const workspace = read?.data?.status ? (read.data.data?.workspaces || []).find((w) => w.companyId === companyId) : null;
    if (!workspace) throw new Error("unread");
    const hosts = workspace.hosts.includes(host) ? workspace.hosts : [...workspace.hosts, host];
    const saved = await apiRequestWithoutCompnay("put", `${env.INSTANCE_EGRESS}/${companyId}`, { hosts, version: workspace.version || 0 });
    if (!saved?.data?.status) throw new Error("unsaved");
};
