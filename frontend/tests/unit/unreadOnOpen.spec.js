import { describe, expect, it } from "vitest";
import { readsOnOpen, dividerAfterCount } from "@/views/Projects/Comments/unreadOnOpen";

const TASK = "6f0000000000000000000701";

describe("opening a task's comments", () => {
    it("reads them when the task has unread comments", () => {
        expect(readsOnOpen({ taskId: TASK, unread: 2 })).toBe(true);
    });

    it("has nothing to read when none are unread", () => {
        expect(readsOnOpen({ taskId: TASK, unread: 0 })).toBe(false);
    });

    it("leaves a chat channel, a new chat and a project thread to the reader's click", () => {
        expect(readsOnOpen({ taskId: TASK, mainChat: true, unread: 2 })).toBe(false);
        expect(readsOnOpen({ taskId: TASK, newChat: true, unread: 2 })).toBe(false);
        expect(readsOnOpen({ taskId: "", unread: 2 })).toBe(false);
        expect(readsOnOpen({ taskId: "default", unread: 2 })).toBe(false);
    });
});

describe("the line above the unread comments", () => {
    it("follows a count that is raised", () => {
        expect(dividerAfterCount({ divider: 1, count: 3 })).toBe(3);
    });

    it("stays where it was when opening the task clears the count", () => {
        expect(dividerAfterCount({ divider: 2, count: 0 })).toBe(2);
    });

    it("goes when another thread opens with nothing unread", () => {
        expect(dividerAfterCount({ divider: 2, count: 0, threadChanged: true })).toBe(0);
    });
});
