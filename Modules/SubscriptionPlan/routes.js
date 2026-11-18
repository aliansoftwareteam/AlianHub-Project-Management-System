const { requireInstanceAdmin } = require("../Instance/guard");
const ctrl = require("./controller");

exports.init = (app) => {
  app.get("/api/v1/subscription", ctrl.getAllSubscriptionPlans);
  app.post("/api/v1/subscription/find", ctrl.findSubscriptionPlans);
  app.get("/api/v1/subscription/:id", ctrl.getSubscriptionPlanById);
  app.put("/api/v1/subscription", requireInstanceAdmin, ctrl.updateSubscriptionPlan);
};
