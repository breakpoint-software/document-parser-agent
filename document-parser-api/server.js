const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initializeServices } = require('./src/config/services');
const { createGoogleAuthMiddleware, createWorkspaceAuthorization, requireOwnUser } = require('./src/middleware/google-auth');
const { createAuthController } = require('./src/controllers/auth-controller');
const { createWorkspaceController } = require('./src/controllers/workspace-controller');
const { createRuleController } = require('./src/controllers/rule-controller');
const { createUserAccountController } = require('./src/controllers/user-account-controller');
const { createDriveController } = require('./src/controllers/drive-controller');
const { createExtractionSchemeController } = require('./src/controllers/extraction-scheme-controller');
const { createAuthRoutes } = require('./src/routes/auth-routes');
const { createWorkspaceRoutes } = require('./src/routes/workspace-routes');
const { createRuleRoutes } = require('./src/routes/rule-routes');
const { createUserAccountRoutes } = require('./src/routes/user-account-routes');
const { createDriveRoutes } = require('./src/routes/drive-routes');
const { createExtractionSchemeRoutes } = require('./src/routes/extraction-scheme-routes');

const app = express();
const port = process.env.PORT || 3000;
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4200,http://localhost:53850')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const services = initializeServices();
const requireGoogleAuth = createGoogleAuthMiddleware(services);
const requireOwnWorkspace = createWorkspaceAuthorization(services);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

app.use('/api/auth', createAuthRoutes(createAuthController(services), requireGoogleAuth, requireOwnUser));
app.use(
  '/api/workspaces/:workspaceId/rules',
  createRuleRoutes(createRuleController(services), requireGoogleAuth, requireOwnWorkspace)
);
app.use(
  '/api/workspaces',
  createWorkspaceRoutes(createWorkspaceController(services), requireGoogleAuth, requireOwnWorkspace)
);
app.use(
  '/api/user-accounts',
  createUserAccountRoutes(
    createUserAccountController(services),
    requireGoogleAuth,
    requireOwnWorkspace,
    requireOwnUser
  )
);
app.use('/api/drive', createDriveRoutes(createDriveController(services), requireGoogleAuth));
app.use(
  '/api/extraction-schemes',
  createExtractionSchemeRoutes(createExtractionSchemeController(services), requireGoogleAuth)
);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend server is running' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Document Parser API listening on port ${port}`);
  });
}

module.exports = app;