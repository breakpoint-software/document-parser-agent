const express = require('express');
const { asyncHandler } = require('./helpers');

function createExtractionSchemeRoutes(controller, requireGoogleAuth) {
  const router = express.Router();
  router.use(requireGoogleAuth);
  router.get('/', asyncHandler(controller.listSchemes));
  router.get('/:schemaId', asyncHandler(controller.getScheme));
  return router;
}

module.exports = { createExtractionSchemeRoutes };
