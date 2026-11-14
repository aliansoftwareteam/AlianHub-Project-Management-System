import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/services", () => ({ apiRequest: vi.fn() }));
vi.mock("@/store/index", () => ({ default: {} }));

import { useCustomComposable } from "@/composable";
import { planState } from "@/composable/planUsage";

const GB = 1024 ** 3;
const company = (bucketStorage = 250 * 1024) => ({ planFeature: { bucketStorage, maxFileSize: null } });

describe("checkBucketStorage reads the live Plan & Usage figures", () => {
    beforeEach(() => {
        Object.assign(planState, { loading: false, loaded: true, failed: false, data: null });
    });

    it("allows a small upload on a brand-new company that has no bucketSize field at all", () => {
        planState.data = { storage: { bytes: 19 * 1024, limit: 250 * GB } };
        const { checkBucketStorage } = useCustomComposable();
        expect(checkBucketStorage([2048], { gettersVal: { "settings/selectedCompany": company() } })).toBe(true);
    });

    it("refuses an upload that would push the live usage past the plan's storage limit", () => {
        planState.data = { storage: { bytes: 249 * GB, limit: 250 * GB } };
        const { checkBucketStorage } = useCustomComposable();
        expect(checkBucketStorage([2 * GB], { gettersVal: { "settings/selectedCompany": company() } })).toBe(false);
    });

    it("treats a plan with no storage limit, or usage that has not loaded yet, as unlimited", () => {
        planState.data = { storage: { bytes: 19 * 1024, limit: null } };
        const { checkBucketStorage } = useCustomComposable();
        expect(checkBucketStorage([5 * GB], { gettersVal: { "settings/selectedCompany": company(null) } })).toBe(true);

        planState.data = null;
        expect(checkBucketStorage([5 * GB], { gettersVal: { "settings/selectedCompany": company(null) } })).toBe(true);
    });
});
