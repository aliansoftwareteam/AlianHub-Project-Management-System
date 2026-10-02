/* A route marked `meta.withoutWorkspace` is a link a mail carries: an invitation, an e-mail to verify, a password to
 * reset. It acts on the token in its address, so it opens for anyone, signed in or not, with a workspace or without.
 * Both the router's guard and App.vue ask here, so the route table is the only place that names those pages. */
export const opensWithoutWorkspace = (route) => route?.meta?.withoutWorkspace === true;
