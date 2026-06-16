import oAuthWithGoogle from "./google/GoogleAuth.vue"
import oAuthWithGithub from "./github/GithubAuth.vue"
import oAuthWithGitlab from "./gitlab/GitlabAuth.vue"
import oAuthProviders from "./oAuthProviders.vue";

export default {
    install(app) {
        app.component('oAuthProviders', oAuthProviders);
        app.component('oAuthWithGoogle', oAuthWithGoogle);
        app.component('oAuthWithGithub', oAuthWithGithub);
        app.component('oAuthWithGitlab', oAuthWithGitlab);
    }
};
