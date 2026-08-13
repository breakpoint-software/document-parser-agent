const express = require('express');
const { asyncHandler } = require('./helpers');

function createWorkspaceRoutes(controller, requireGoogleAuth, requireOwnWorkspace) {
  const router = express.Router();
  router.use(requireGoogleAuth);
  router.get('/user/all', asyncHandler(controller.listWorkspaces));
  router.post('/', asyncHandler(controller.createWorkspace));
  router.get('/:workspaceId', requireOwnWorkspace, asyncHandler(controller.getWorkspace));
  router.put('/:workspaceId', requireOwnWorkspace, asyncHandler(controller.updateWorkspace));
  router.delete('/:workspaceId', requireOwnWorkspace, asyncHandler(controller.deleteWorkspace));
  return router;
}

module.exports = { createWorkspaceRoutes };