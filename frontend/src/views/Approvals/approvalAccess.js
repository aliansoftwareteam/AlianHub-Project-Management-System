import { isOwnerOrAdmin } from "@/utils/roles";

/* Mirrors canReview in Modules/TimesheetApproval/helpers/approvalRules.js: owners and admins approve, send back and reopen. */
export const canApprove = (companyUser) => isOwnerOrAdmin(companyUser?.roleType);

/* The standing approval was given by the person whose week it is. */
export const isOwnApproval = (approval) => approval?.status === "approved" && approval.selfApproved === true;

/* The last reopening in a timesheet week's history, or null. */
export function lastReopenOf(approval) {
    const reopenings = (approval?.history || []).filter((entry) => entry?.action === "reopen");
    return reopenings.length ? reopenings[reopenings.length - 1] : null;
}
