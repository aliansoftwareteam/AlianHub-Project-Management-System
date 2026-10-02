const {
    escapeCommentText, escapeCommentFields, decodeCommentText, commentHtml, commentPlainText,
} = require('../Modules/Comments/helpers/plainText');

describe('escapeCommentText', () => {
    test('text from an API caller with angle brackets is stored escaped', () => {
        expect(escapeCommentText('<b>hi</b> & "bye"')).toBe('&lt;b&gt;hi&lt;/b&gt; &amp; &quot;bye&quot;');
    });

    test('text without angle brackets is left exactly as it came, even with an ampersand', () => {
        expect(escapeCommentText('Tom & Jerry')).toBe('Tom & Jerry');
        expect(escapeCommentText('already &lt;escaped&gt; by the app')).toBe('already &lt;escaped&gt; by the app');
    });

    test('a value that is not text is returned untouched', () => {
        expect(escapeCommentText(null)).toBeNull();
        expect(escapeCommentText(5)).toBe(5);
        expect(escapeCommentText(undefined)).toBeUndefined();
    });
});

describe('escapeCommentFields', () => {
    test('escapes message and reply_message only, and does not change the original object', () => {
        const input = { message: '<i>a</i>', reply_message: '<u>b</u>', other: '<keep>' };
        const out = escapeCommentFields(input);
        expect(out).toEqual({ message: '&lt;i&gt;a&lt;/i&gt;', reply_message: '&lt;u&gt;b&lt;/u&gt;', other: '<keep>' });
        expect(input.message).toBe('<i>a</i>');
    });

    test('a field that is absent is not added', () => {
        expect(escapeCommentFields({ message: 'x' })).toEqual({ message: 'x' });
    });

    test('null, text and undefined pass straight through', () => {
        expect(escapeCommentFields(null)).toBeNull();
        expect(escapeCommentFields('plain')).toBe('plain');
        expect(escapeCommentFields(undefined)).toBeUndefined();
    });
});

describe('decodeCommentText', () => {
    test('turns the entities the web app writes back into characters', () => {
        expect(decodeCommentText('&lt;p&gt; &amp; &quot;q&quot; &#39;s&#39; &#039;t&#039; &#96;c&#96; &#40;a&#41;')).toBe('<p> & "q" \'s\' \'t\' `c` (a)');
    });

    test('decodes once only: an escaped ampersand stays an entity afterwards', () => {
        expect(decodeCommentText('&amp;lt;')).toBe('&lt;');
    });

    test('null and undefined read as empty text; a number reads as its digits', () => {
        expect(decodeCommentText(null)).toBe('');
        expect(decodeCommentText(undefined)).toBe('');
        expect(decodeCommentText(0)).toBe('0');
    });
});

describe('commentHtml and commentPlainText', () => {
    const mention = 'Ping @[Asha Rao](u1234abcd) please';

    test('a mention shows as a highlighted name in html and as @name in plain text', () => {
        expect(commentHtml(mention)).toBe('Ping <b class="mentioned">@Asha Rao</b> please');
        expect(commentPlainText(mention)).toBe('Ping @Asha Rao please');
    });

    test('script typed by a person is shown as text, whether it arrived raw or already escaped', () => {
        expect(commentHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(commentHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    test('a mention whose id is too short is not a mention', () => {
        expect(commentPlainText('@[Asha](ab)')).toBe('@[Asha](ab)');
    });

    test('two mentions in one comment are both read', () => {
        expect(commentPlainText('@[A B](aaaa) and @[C D](bbbb)')).toBe('@A B and @C D');
    });

    test('empty input gives empty output', () => {
        expect(commentHtml('')).toBe('');
        expect(commentPlainText(undefined)).toBe('');
    });
});
