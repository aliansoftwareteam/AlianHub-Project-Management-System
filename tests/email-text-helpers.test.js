const {
    textHtml, messageHtml, subjectText, cssColor, imageSrc, urlSegment,
} = require('../Modules/Template/emailText');

describe('textHtml', () => {
    test('text typed with a tag is shown as text in the email', () => {
        expect(textHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    });

    test('text the web app already escaped is not escaped a second time', () => {
        expect(textHtml('Tom &amp; Jerry')).toBe('Tom &amp; Jerry');
    });

    test('null and undefined give an empty string', () => {
        expect(textHtml(null)).toBe('');
        expect(textHtml(undefined)).toBe('');
    });
});

describe('messageHtml', () => {
    test('bold, italic and paragraph tags in a notification message stay as formatting', () => {
        expect(messageHtml('<b>Due</b> <em>today</em><br>ok')).toBe('<b>Due</b> <em>today</em><br>ok');
    });

    test('a tag with attributes does not come back as a tag', () => {
        expect(messageHtml('<b onclick="x()">hi</b>')).not.toContain('onclick="x()">');
        expect(messageHtml('<b onclick="x()">hi</b>')).toContain('&lt;b onclick=');
    });

    test('a script tag stays text', () => {
        expect(messageHtml('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
    });

    test('a mention is highlighted', () => {
        expect(messageHtml('Hi @[Asha Rao](u1234abcd)')).toBe('Hi <b class="mentioned">@Asha Rao</b>');
    });
});

describe('subjectText', () => {
    test('a subject is one line of plain words, mentions turned into @name', () => {
        expect(subjectText('  New   comment\n from @[Asha Rao](u1234abcd)  ')).toBe('New comment from @Asha Rao');
    });

    test('empty input gives an empty subject', () => {
        expect(subjectText(undefined)).toBe('');
    });
});

describe('cssColor', () => {
    test('accepts hex, named and rgb or hsl colours', () => {
        expect(cssColor('#fff')).toBe('#fff');
        expect(cssColor(' #A1B2C3 ')).toBe('#A1B2C3');
        expect(cssColor('tomato')).toBe('tomato');
        expect(cssColor('rgba(10, 20, 30, 0.5)')).toBe('rgba(10, 20, 30, 0.5)');
        expect(cssColor('hsl(120, 50%, 50%)')).toBe('hsl(120, 50%, 50%)');
    });

    test('anything that could break out of a style attribute is refused', () => {
        expect(cssColor('red;background:url(x)')).toBe('');
        expect(cssColor('red" onclick="x')).toBe('');
        expect(cssColor('url(javascript:x)')).toBe('');
        expect(cssColor('#12')).toBe('');
    });

    test('empty, null and a number give nothing', () => {
        expect(cssColor('')).toBe('');
        expect(cssColor(null)).toBe('');
        expect(cssColor(undefined)).toBe('');
        expect(cssColor(123)).toBe('');
    });
});

describe('imageSrc', () => {
    test('https, root-relative and small data images are allowed', () => {
        expect(imageSrc('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
        expect(imageSrc('/api/v1/getlogo?key=a')).toBe('/api/v1/getlogo?key=a');
        expect(imageSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    });

    test('script, svg data and protocol-relative addresses are refused', () => {
        expect(imageSrc('javascript:alert(1)')).toBe('');
        expect(imageSrc('data:image/svg+xml;base64,AAA')).toBe('');
        expect(imageSrc('//evil.example.com/a.png')).toBe('');
        expect(imageSrc('data:text/html;base64,AAA')).toBe('');
    });

    test('a quote in the address is escaped so it cannot close the attribute', () => {
        expect(imageSrc('https://a.example.com/x".png')).toBe('https://a.example.com/x&quot;.png');
    });

    test('empty and missing values give nothing', () => {
        expect(imageSrc('')).toBe('');
        expect(imageSrc(null)).toBe('');
    });
});

describe('urlSegment', () => {
    test('slashes, spaces and question marks cannot leave their place in the path', () => {
        expect(urlSegment('a/b c?d')).toBe('a%2Fb%20c%3Fd');
    });

    test('null and undefined give an empty segment; zero stays zero', () => {
        expect(urlSegment(null)).toBe('');
        expect(urlSegment(undefined)).toBe('');
        expect(urlSegment(0)).toBe('0');
    });
});
