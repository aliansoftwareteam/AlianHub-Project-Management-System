const { DOC_NOTICE_SECTION, docNoticeSection } = require('../../Config/notificationKey');
const { sectionHealer } = require('./noticeSections');

const healer = sectionHealer(DOC_NOTICE_SECTION, docNoticeSection);

module.exports = { ensureDocNoticeSection: healer.ensure, forgetHealedDocNotices: healer.forget };
