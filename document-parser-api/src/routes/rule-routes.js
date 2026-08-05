const express = require('express');
const { asyncHandler } = require('./helpers');

function createRuleRoutes(controller, requireGoogleAuth, requireOwnTenant) {
  const router = express.Router({ mergeParams: true });
  router.use(requireGoogleAuth, requireOwnTenant);
  router.get('/', asyncHandler(controller.listRules));
  router.post('/', asyncHandler(controller.createRule));
  router.put('/:ruleId', asyncHandler(controller.updateRule));
  router.delete('/:ruleId', asyncHandler(controller.deleteRule));
  return router;
}

module.exports = { createRuleRoutes };