const express = require('express');
const { asyncHandler } = require('./helpers');

function createAuthRoutes(controller, requireGoogleAuth, requireOwnUser) {
  const router = express.Router();
  router.post('/google', asyncHandler(controller.googleLogin));
  router.use(requireGoogleAuth);
  router.get('/user/:uid', requireOwnUser, asyncHandler(controller.getCurrentUser));
  router.post('/logout', controller.logout);
  router.post('/get-access-token', asyncHandler(controller.getAccessToken));
  return router;
}

module.exports = { createAuthRoutes };