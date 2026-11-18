import { describe, expect, it } from "vitest";
import { unreadCommentsOf } from "@/views/Projects/components/unreadComments";

describe("unreadCommentsOf", () => {
    const task = { _id: "t1", ProjectID: "p1", sprintId: "s1" };

    it("adds the task's own unread comments to its subtasks'", () => {
        expect(unreadCommentsOf({ task_p1_s1_t1_comments: 2, parentTask_p1_s1_t1_comments: 3 }, task)).toBe(5);
    });

    it("is zero with no counts or for another task", () => {
        expect(unreadCommentsOf(undefined, task)).toBe(0);
        expect(unreadCommentsOf({ task_p1_s1_t2_comments: 4 }, task)).toBe(0);
    });
});
