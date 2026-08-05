const express = require('express');
const { asyncHandler } = require('./helpers');

function createTenantRoutes(controller, requireGoogleAuth, requireOwnTenant) {
  const router = express.Router();
  router.use(requireGoogleAuth);
  router.get('/user/all', asyncHandler(controller.listTenants));
  router.post('/', asyncHandler(controller.createTenant));
  router.get('/:tenantId', requireOwnTenant, asyncHandler(controller.getTenant));
  router.put('/:tenantId', requireOwnTenant, asyncHandler(controller.updateTenant));
  router.delete('/:tenantId', requireOwnTenant, asyncHandler(controller.deleteTenant));
  return router;
}

module.exports = { createTenantRoutes };