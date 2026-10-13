const { htmlToRawText } = require('../Pages/helpers/pageRules');
const { blocksToRawText, contentToEditorData } = require('../Pages/helpers/pageContent');

const PAGE_TEXT_MAX = 40000;

/* Stored rawText is a 5000-char search excerpt, so the full body comes from the html. */
const pageText = (page) => {
    const content = page.content || {};
    if (content.html) return htmlToRawText(content.html, PAGE_TEXT_MAX);
    if (page.rawText) return String(page.rawText);
    return blocksToRawText(contentToEditorData(content), PAGE_TEXT_MAX);
};

module.exports = { PAGE_TEXT_MAX, pageText };
