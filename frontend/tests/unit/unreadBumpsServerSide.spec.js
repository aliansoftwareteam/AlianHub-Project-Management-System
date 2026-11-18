import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (file) => fs.readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');

const SENDERS = {
    'the comment box': read('views/Projects/Comments/Comments.vue'),
    'the chat panel': read('components/organisms/MainChat/useMainChatConversation.js'),
};

describe('unread counts of the people a comment reaches are raised by the server', () => {
    it.each(Object.entries(SENDERS))('%s only changes the reader\'s own count', (_name, source) => {
        const recipientLists = source.match(/userIds:\s*(?![\s{])[^,\n]+/g) || [];

        expect(source).toMatch(/UPDATE_UNREADREAD_COMMENTS_COUNT/);
        expect(recipientLists.filter((field) => !/^userIds:\s*\[userId\.value\]$/.test(field))).toEqual([]);
        expect(source).not.toMatch(/bumpUnread|filterUsers/);
    });
});
