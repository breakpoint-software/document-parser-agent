const express = require('express');
const { asyncHandler } = require('./helpers');

function createDriveRoutes(controller, requireGoogleAuth) {
  const router = express.Router();
  router.use(requireGoogleAuth);
  router.post('/share', asyncHandler(controller.shareFile));
  return router;
}

module.exports = { createDriveRoutes };