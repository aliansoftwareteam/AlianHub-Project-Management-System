import { computed } from "vue";
import { useStore } from "vuex";

const PUBLIC_DOCS = "https://docs.alianhub.com";

export const GUIDE = Object.freeze({
    CLAUDE_CODE_DEVELOPER: "ai/claude-code-developer",
});

// A self-hoster's brand help link points at their own copy of the docs; without one the public docs answer.
export const docsUrlFor = (path, helpLink = "") => `${String(helpLink || PUBLIC_DOCS).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;

export const useDocsLink = (path) => {
    const store = useStore();
    return computed(() => docsUrlFor(path, store?.getters?.["brandSettingTab/brandSettings"]?.helpLink));
};
