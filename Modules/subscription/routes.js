const { requireInstanceAdmin } = require('../Instance/guard');
const ctrl = require("./controller");

exports.init = (app) => {
  app.get("/api/v1/subscriptions/:id", ctrl.getSubscriptions);
  app.post("/api/v1/subscriptions", requireInstanceAdmin, ctrl.subscriptionTabFetchSubscriptionData);
};
