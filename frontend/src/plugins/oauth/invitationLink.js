const KEY = "invitationLinkId";

/* GitHub and GitLab send the browser back to a fresh page, so the invitation's link token waits
 * in this tab's sessionStorage: it outlives the redirect but not the tab. */
export const rememberInvitationLink = (linkId) => {
    if (linkId) sessionStorage.setItem(KEY, linkId);
    else sessionStorage.removeItem(KEY);
};

export const takeInvitationLink = () => {
    const linkId = sessionStorage.getItem(KEY) || "";
    sessionStorage.removeItem(KEY);
    return linkId;
};
