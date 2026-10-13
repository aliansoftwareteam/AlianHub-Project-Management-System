const { GOAL_NOTICE_SECTION, goalNoticeSection } = require('../../Config/notificationKey');
const { sectionHealer } = require('./noticeSections');

const healer = sectionHealer(GOAL_NOTICE_SECTION, goalNoticeSection);

module.exports = { ensureGoalNoticeSection: healer.ensure, forgetHealedGoalNotices: healer.forget };
