const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initializeServices } = require('./src/config/services');
const { createGoogleAuthMiddleware, requireOwnTenant, requireOwnUser } = require('./src/middleware/google-auth');
const { createAuthController } = require('./src/controllers/auth-controller');
const { createTenantController } = require('./src/controllers/tenant-controller');
const { createRuleController } = require('./src/controllers/rule-controller');
const { createUserAccountController } = require('./src/controllers/user-account-controller');
const { createDriveController } = require('./src/controllers/drive-controller');
const { createAuthRoutes } = require('./src/routes/auth-routes');
const { createTenantRoutes } = require('./src/routes/tenant-routes');
const { createRuleRoutes } = require('./src/routes/rule-routes');
const { createUserAccountRoutes } = require('./src/routes/user-account-routes');
const { createDriveRoutes } = require('./src/routes/drive-routes');

const app = express();
const port = process.env.PORT || 3000;
const services = initializeServices();
const requireGoogleAuth = createGoogleAuthMiddleware(services);

app.use(cors({
  origin: ['http://localhost:4200', 'http://localhost:53850'],
  credentials: true
}));
app.use(express.json());

app.use('/api/auth', createAuthRoutes(createAuthController(services), requireGoogleAuth, requireOwnUser));
app.use(
  '/api/tenants/:tenantId/rules',
  createRuleRoutes(createRuleController(services), requireGoogleAuth, requireOwnTenant)
);
app.use(
  '/api/tenants',
  createTenantRoutes(createTenantController(services), requireGoogleAuth, requireOwnTenant)
);
app.use(
  '/api/user-accounts',
  createUserAccountRoutes(
    createUserAccountController(services),
    requireGoogleAuth,
    requireOwnTenant,
    requireOwnUser
  )
);
app.use('/api/drive', createDriveRoutes(createDriveController(services), requireGoogleAuth));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend server is running' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Document Parser API listening on port ${port}`);
  });
}

module.exports = app;