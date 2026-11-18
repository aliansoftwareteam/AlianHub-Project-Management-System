import { describe, it, expect, vi, beforeEach } from "vitest";

const apiRequest = vi.fn(() => Promise.resolve({ data: { status: true, url: "http://signed", statusText: "http://signed" } }));
vi.mock("@/services", () => ({ apiRequest: (...args) => apiRequest(...args) }));
vi.mock("@/store/index", () => ({ default: {} }));

import { useCustomComposable } from "@/composable";

describe("getWasabiImageLink", () => {
    beforeEach(() => apiRequest.mockClear());

    it("signs nothing for an empty path, so a bundled priority icon cannot fail a priority change", async () => {
        const { getWasabiImageLink } = useCustomComposable();
        await expect(getWasabiImageLink("c1", "")).resolves.toBe("");
        await expect(getWasabiImageLink("c1", undefined)).resolves.toBe("");
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it("still signs a stored path", async () => {
        const { getWasabiImageLink } = useCustomComposable();
        await getWasabiImageLink("c1", "taskPriorities/priority_high.png");
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });
});
