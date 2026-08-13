const express = require('express');
const { asyncHandler } = require('./helpers');

function createUserAccountRoutes(controller, requireGoogleAuth, requireOwnWorkspace, requireOwnUser) {
  const router = express.Router();
  router.use(requireGoogleAuth);
  router.post('/', asyncHandler(controller.createAccount));
  router.get('/uid/:uid', requireOwnUser, asyncHandler(controller.getAccount));
  router.get('/workspace/:workspaceId', requireOwnWorkspace, asyncHandler(controller.listWorkspaceAccounts));
  router.get('/:accountId', requireOwnUser, asyncHandler(controller.getAccount));
  router.put('/:accountId', requireOwnUser, asyncHandler(controller.updateAccount));
  router.delete('/:accountId', requireOwnUser, asyncHandler(controller.deleteAccount));
  return router;
}

module.exports = { createUserAccountRoutes };