import { describe, expect, it } from "vitest";
import { placeOfIncoming } from "@/views/Projects/Comments/incomingComment";

const PERSON = "6f0000000000000000000d01";

const typed = { _id: "c1", userId: PERSON, type: "text", message: "I will look", mediaURL: "", mediaName: "" };
const fromConnectedAi = {
    _id: "c2", userId: PERSON, type: "text", message: "Done, see the PR", mediaURL: "", mediaName: "",
    isAgent: true, actorType: "agent", viaAccount: "external", agentName: "Claude Code (app · claude.ai), for Local PM",
};
const uploading = { isSending: "tmp-1", userId: PERSON, type: "image", mediaName: "shot.png", mediaURL: "data:image/png;base64,AA" };

/* What the comment list does with each socket insert. */
const receive = (rows, doc) => {
    const place = placeOfIncoming(rows, doc, { replaceSending: true });
    if (place.kind === "new") return [...rows, doc];
    const settled = place.kind === "pending" ? doc : null;
    return rows.map((row, at) => (at === place.index ? settled || { ...row, ...doc } : row));
};

describe("a comment heard over the socket", () => {
    it("shows a comment the person's connected AI wrote under the person's own user id", () => {
        const rows = receive([typed], fromConnectedAi);

        expect(rows.map((row) => row._id)).toEqual(["c1", "c2"]);
    });

    it("does not show the person's own typed comment twice when its insert is heard again", () => {
        const rows = receive(receive([], typed), { ...typed });

        expect(rows).toHaveLength(1);
    });

    it("leaves the person's pending upload alone when the AI's text comment arrives", () => {
        const rows = receive([typed, uploading], fromConnectedAi);

        expect(rows).toHaveLength(3);
        expect(rows[1].isSending).toBe("tmp-1");
    });

    it("settles the pending upload when its stored row comes back", () => {
        const stored = { _id: "c3", userId: PERSON, type: "image", mediaName: "shot.png", mediaURL: "https://files/shot.png" };
        const rows = receive([typed, uploading], stored);

        expect(rows.map((row) => row._id)).toEqual(["c1", "c3"]);
        expect(rows[1].isSending).toBeUndefined();
    });
});
