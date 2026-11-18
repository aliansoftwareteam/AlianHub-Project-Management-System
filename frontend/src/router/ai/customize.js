export const CUSTOMIZE_ROUTE = "AiCustomize";
export const CUSTOMIZE_PATH = "/:cid/ai/customize";

export const CUSTOMIZE_TAB = Object.freeze({ CONNECTORS: "connectors", CONNECT_AI: "connect-ai", WORKSPACE: "workspace" });

/* Where the old Connections and Connect your AI addresses now lead; the query rides along, so a
 * provider's sign-in that returns to an old address still finishes. */
export const toCustomize = (tab) => (to) => ({
    name: CUSTOMIZE_ROUTE,
    params: { cid: to.params.cid },
    query: tab ? { ...to.query, tab } : { ...to.query },
});
