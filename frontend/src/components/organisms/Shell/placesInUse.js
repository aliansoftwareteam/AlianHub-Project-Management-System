import { fetchDashboards } from "@/plugins/dashboard/dashboardsApi";

/* The places a person's projects already use, which Simple then shows on the rail without being
   asked. The list holds only what this person may open. */
export async function placesInUse() {
    const dashboards = await fetchDashboards().catch(() => []);
    return (dashboards || []).some((dashboard) => dashboard.visibility === "project") ? ["dash"] : [];
}
