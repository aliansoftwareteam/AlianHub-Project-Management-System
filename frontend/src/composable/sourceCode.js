import * as env from "@/config/env";

/* AGPL §13: people using a hosted copy over the network are offered its source. A release
 * build has a tag; a build between releases is named by its commit. */
export function sourceCodeUrl({ version = "", release = "", commit = "" } = {}) {
    if (release && version === release) return `${env.REPO_URL}/tree/v${release}`;
    if (commit) return `${env.REPO_URL}/tree/${commit}`;
    return `${env.REPO_URL}/tree/v${release || version}`;
}
