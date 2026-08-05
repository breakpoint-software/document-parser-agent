const express = require('express');
const { asyncHandler } = require('./helpers');

function createUserAccountRoutes(controller, requireGoogleAuth, requireOwnTenant, requireOwnUser) {
  const router = express.Router();
  router.use(requireGoogleAuth);
  router.post('/', asyncHandler(controller.createAccount));
  router.get('/uid/:uid', requireOwnUser, asyncHandler(controller.getAccount));
  router.get('/tenant/:tenantId', requireOwnTenant, asyncHandler(controller.listTenantAccounts));
  router.get('/:accountId', requireOwnUser, asyncHandler(controller.getAccount));
  router.put('/:accountId', requireOwnUser, asyncHandler(controller.updateAccount));
  router.delete('/:accountId', requireOwnUser, asyncHandler(controller.deleteAccount));
  return router;
}

module.exports = { createUserAccountRoutes };