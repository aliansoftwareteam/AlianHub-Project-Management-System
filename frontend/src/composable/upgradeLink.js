import { isManagedHosting, publicConfig } from "@/config/publicConfig";

export const PLAN_ROUTE = "PlanUsage";

/* Hosted, plans are bought in the AlianHub account: the Plan & usage page when this build has
 * it, else the account portal itself. Self-hosted keeps the in-app Upgrade route. */
export function upgradeTarget(router, cid) {
    if (!isManagedHosting()) return { name: "Upgrade", params: { cid } };
    return router.hasRoute(PLAN_ROUTE) ? { name: PLAN_ROUTE, params: { cid } } : null;
}

export function openUpgrade(router, cid) {
    const target = upgradeTarget(router, cid);
    if (target) return router.push(target);
    if (publicConfig.hosting?.portalUrl) window.open(publicConfig.hosting.portalUrl, "_blank", "noopener");
    return Promise.resolve();
}

export const isBillingRoute = (to) => to.name === "Upgrade" || to.matched.some((record) => record.meta?.billing);
