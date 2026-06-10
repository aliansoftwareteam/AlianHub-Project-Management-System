import { createI18n } from "vue-i18n";
import en from "./en";
import it from "./it";
import ge from "./ge";
import spa from "./spa";
import gr from "./gr";
import ch from "./ch";
import ru from "./ru";
import hi from "./hi";
import gu from "./gu";
import fr from "./fr";
import ja from "./ja";
import ko from "./ko";
import ptBr from "./ptBr";

export const i18n = createI18n({
    legacy: false,
    globalInjection: true, // REQUIRED
    locale: localStorage.getItem("language") || "en",
    fallbackLocale: "en",
    messages: {
        en,
        it,
        ge,
        spa,
        gr,
        ch,
        ru,
        hi,
        gu,
        fr,
        ja,
        ko,
        ptBr
    },
});
