import { useI18n } from "vue-i18n";

/* The key scripts/demo/industries stores on a demo company: on the full row, or flattened on the login picker's list. */
export const industryKeyOf = (company) => String((company && (company.demoIndustry || (company.demoShowcase && company.demoShowcase.industry))) || "");

/* The industry a demo company shows under its name; empty for every other company and for an industry with no label. */
export function useDemoIndustry() {
    const { t, te } = useI18n();
    const industryOf = (company) => {
        const key = industryKeyOf(company);
        return key && te(`Demo.industry_${key}`) ? t(`Demo.industry_${key}`) : "";
    };
    return { industryOf };
}
