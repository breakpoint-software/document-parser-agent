const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['http://localhost:4200', 'http://localhost:53850'],
  credentials: true
}));
app.use(express.json());

// Initialize Firebase Admin SDK
// Use the service account key from environment or file
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

if (Object.keys(serviceAccount).length > 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://dragonbotdb-fdda7-default-rtdb.firebaseio.com'
  });
} else {
  console.warn('⚠️  Firebase service account not configured. Set FIREBASE_SERVICE_ACCOUNT environment variable.');
}

const db = admin.firestore();
const auth = admin.auth();

// Google OAuth Client
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage'
);

/**
 * Helper function to sanitize email for use as document ID
 */
function sanitizeEmail(email) {
  if (!email) return '';
  return email
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

async function upsertTenantForUser({ uid, email, displayName, photoURL, refreshToken }) {
  const tenantRef = db.collection('tenants').doc(uid);
  const tenantName = (displayName || email.split('@')[0]).trim();

  await db.runTransaction(async transaction => {
    const tenantDoc = await transaction.get(tenantRef);
    const tenantData = {
      tenant_id: uid,
      name: tenantName,
      email,
      displayName: displayName || '',
      photoURL: photoURL || '',
      active: true,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      last_sign_in: admin.firestore.FieldValue.serverTimestamp()
    };

    if (refreshToken) {
      tenantData.refresh_token = refreshToken;
      tenantData.refresh_token_updated_at = admin.firestore.FieldValue.serverTimestamp();
    }

    if (!tenantDoc.exists) {
      tenantData.created_at = admin.firestore.FieldValue.serverTimestamp();
    }

    transaction.set(tenantRef, tenantData, { merge: true });
  });

  return { id: uid, tenant_id: uid, name: tenantName, email, active: true };
}

/**
 * GET /api/auth/user/:uid
 * Get user profile
 */
app.get('/api/auth/user/:uid', async (req, res) => {
  try {
    const { uid } = req.params;

    const tenantDoc = await db.collection('tenants').doc(uid).get();

    if (!tenantDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const tenant = tenantDoc.data();

    res.json({ 
      success: true,
      user: {
        uid,
        email: tenant.email,
        displayName: tenant.displayName,
        photoURL: tenant.photoURL
      },
      tenant: { id: uid, ...tenant }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch user',
      message: error.message 
    });
  }
});

/**
 * POST /api/auth/logout
 * Handle logout (just validation endpoint)
 */
app.post('/api/auth/logout', async (req, res) => {
  try {
    res.json({ 
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Logout failed',
      message: error.message 
    });
  }
});

/**
 * ============================================
 * REFRESH TOKEN ENDPOINTS (for background processes)
 * ============================================
 */

/**
 * POST /api/auth/google
 * Exchange a Google authorization code, persist the tenant and refresh token,
 * and return a Firebase custom token without opening a second popup.
 * Body: { code }
 */
app.post('/api/auth/google', async (req, res) => {
  try {
    const { code } = req.body;

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({
        error: 'Backend Google OAuth credentials are not configured',
        code: 'OAUTH_CONFIG_MISSING'
      });
    }

    if (!code) {
      return res.status(400).json({ 
        error: 'Missing required field: code'
      });
    }

    const { tokens } = await googleClient.getToken(code);

    if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token) {
      return res.status(400).json({
        error: 'Google did not return all required tokens. Revoke the existing app grant and consent again.',
        code: 'INCOMPLETE_GOOGLE_TOKENS'
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const googleUser = ticket.getPayload();

    if (!googleUser?.email || !googleUser.email_verified) {
      return res.status(400).json({ error: 'Google account does not have a verified email address' });
    }

    let firebaseUser;
    try {
      firebaseUser = await auth.getUserByEmail(googleUser.email);
      firebaseUser = await auth.updateUser(firebaseUser.uid, {
        displayName: googleUser.name,
        photoURL: googleUser.picture
      });
    } catch (error) {
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }

      firebaseUser = await auth.createUser({
        email: googleUser.email,
        emailVerified: true,
        displayName: googleUser.name,
        photoURL: googleUser.picture
      });
    }

    await upsertTenantForUser({
      uid: firebaseUser.uid,
      email: googleUser.email,
      displayName: googleUser.name,
      photoURL: googleUser.picture,
      refreshToken: tokens.refresh_token
    });

    const customToken = await auth.createCustomToken(firebaseUser.uid);

    res.json({
      success: true,
      customToken,
      googleAccessToken: tokens.access_token
    });
  } catch (error) {
    console.error('Google authentication error:', error);
    res.status(500).json({ 
      error: 'Google authentication failed',
      message: error.message 
    });
  }
});

/**
 * POST /api/auth/get-access-token
 * Exchange refresh token for new access token
 * Used by background processes to get fresh access tokens
 * Body: { uid } - retrieves stored refresh token for this user
 */
app.post('/api/auth/get-access-token', async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ 
        error: 'Missing required field: uid' 
      });
    }

    // Get the tenant's refresh token from database
    const tenantDoc = await db.collection('tenants').doc(uid).get();
    if (!tenantDoc.exists) {
      return res.status(404).json({ 
        error: 'Tenant not found' 
      });
    }

    const tenantData = tenantDoc.data();
    const refreshToken = tenantData?.refresh_token;

    if (!refreshToken) {
      return res.status(400).json({ 
        error: 'No refresh token found. User must login again.',
        code: 'NO_REFRESH_TOKEN'
      });
    }

    // Exchange refresh token for new access token
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Token refresh failed:', errorData);
      
      if (errorData.error === 'invalid_grant') {
        // Refresh token has expired, user needs to re-login
        return res.status(401).json({ 
          error: 'Refresh token expired. User must login again.',
          code: 'REFRESH_TOKEN_EXPIRED'
        });
      }

      return res.status(tokenResponse.status).json({ 
        error: 'Failed to refresh token',
        message: errorData.error_description || errorData.error
      });
    }

    const tokens = await tokenResponse.json();
    console.log(`✅ New access token obtained for user ${uid}`);

    res.json({ 
      success: true,
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in,
      tokenType: tokens.token_type
    });
  } catch (error) {
    console.error('Get access token error:', error);
    res.status(500).json({ 
      error: 'Failed to get access token',
      message: error.message 
    });
  }
});

/**
 * ============================================
 * TENANT ENDPOINTS
 * ============================================
 */

/**
 * POST /api/tenants
 * Create a new tenant
 */
app.post('/api/tenants', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ 
        error: 'Missing required field: name' 
      });
    }

    const tenantId = `tenant_${Date.now()}`;
    const tenantData = {
      tenant_id: tenantId,
      name: name.trim(),
      active: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('tenants').doc(tenantId).set(tenantData);

    res.status(201).json({
      success: true,
      message: 'Tenant created successfully',
      tenant: { ...tenantData, id: tenantId }
    });
  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({
      error: 'Failed to create tenant',
      message: error.message
    });
  }
});

/**
 * GET /api/tenants/:tenantId
 * Get tenant by ID
 */
app.get('/api/tenants/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const tenantDoc = await db.collection('tenants').doc(tenantId).get();

    if (!tenantDoc.exists) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({
      success: true,
      tenant: { id: tenantId, ...tenantDoc.data() }
    });
  } catch (error) {
    console.error('Get tenant error:', error);
    res.status(500).json({
      error: 'Failed to fetch tenant',
      message: error.message
    });
  }
});

/**
 * PUT /api/tenants/:tenantId
 * Update tenant
 */
app.put('/api/tenants/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, active } = req.body;

    const updateData = {
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    if (name) updateData.name = name.trim();
    if (active !== undefined) updateData.active = active;

    await db.collection('tenants').doc(tenantId).update(updateData);

    const updatedDoc = await db.collection('tenants').doc(tenantId).get();

    res.json({
      success: true,
      message: 'Tenant updated successfully',
      tenant: { id: tenantId, ...updatedDoc.data() }
    });
  } catch (error) {
    console.error('Update tenant error:', error);
    res.status(500).json({
      error: 'Failed to update tenant',
      message: error.message
    });
  }
});

/**
 * GET /api/tenants/user/all
 * Get all tenants for current user
 */
app.get('/api/tenants/user/all', async (req, res) => {
  try {
    const snapshot = await db.collection('tenants').get();
    const tenants = [];

    snapshot.forEach(doc => {
      tenants.push({ id: doc.id, ...doc.data() });
    });

    res.json({
      success: true,
      tenants
    });
  } catch (error) {
    console.error('Get user tenants error:', error);
    res.status(500).json({
      error: 'Failed to fetch tenants',
      message: error.message
    });
  }
});

/**
 * DELETE /api/tenants/:tenantId
 * Delete tenant
 */
app.delete('/api/tenants/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;

    await db.collection('tenants').doc(tenantId).delete();

    res.json({
      success: true,
      message: 'Tenant deleted successfully'
    });
  } catch (error) {
    console.error('Delete tenant error:', error);
    res.status(500).json({
      error: 'Failed to delete tenant',
      message: error.message
    });
  }
});

/**
 * ============================================
 * RULE ENDPOINTS
 * ============================================
 */

const RULE_FIELDS = [
  'rule_name',
  'source_folder_id',
  'source_folder_name',
  'target_folder_id',
  'target_folder_name',
  'target_sheet_id',
  'target_sheet_name',
  'sheet_tab_name',
  'parsing_prompt',
  'is_enabled'
];

const REQUIRED_RULE_FIELDS = [
  'rule_name',
  'source_folder_id',
  'target_folder_id',
  'target_sheet_id',
  'sheet_tab_name',
  'parsing_prompt'
];

function serializeFirestoreValue(value) {
  return value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value;
}

function serializeRule(ruleId, data) {
  return Object.fromEntries(
    Object.entries({ rule_id: ruleId, ...data })
      .map(([key, value]) => [key, serializeFirestoreValue(value)])
  );
}

function getRulePayload(body) {
  return RULE_FIELDS.reduce((payload, field) => {
    if (body[field] !== undefined) {
      payload[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
    }
    return payload;
  }, {});
}

function getMissingRuleFields(rule) {
  return REQUIRED_RULE_FIELDS.filter(field => typeof rule[field] !== 'string' || !rule[field]);
}

app.get('/api/tenants/:tenantId/rules', async (req, res) => {
  try {
    const snapshot = await db.collection('tenants').doc(req.params.tenantId)
      .collection('rules').orderBy('updated_at', 'desc').get();
    const rules = snapshot.docs.map(doc => serializeRule(doc.id, doc.data()));

    res.json({ success: true, rules });
  } catch (error) {
    console.error('Get rules error:', error);
    res.status(500).json({ error: 'Failed to fetch rules', message: error.message });
  }
});

app.post('/api/tenants/:tenantId/rules', async (req, res) => {
  try {
    const tenantRef = db.collection('tenants').doc(req.params.tenantId);
    const tenantDoc = await tenantRef.get();
    if (!tenantDoc.exists) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const ruleData = getRulePayload(req.body);
    const missingFields = getMissingRuleFields(ruleData);
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }

    ruleData.is_enabled = ruleData.is_enabled ?? true;
    ruleData.created_at = admin.firestore.FieldValue.serverTimestamp();
    ruleData.updated_at = admin.firestore.FieldValue.serverTimestamp();

    const ruleRef = await tenantRef.collection('rules').add(ruleData);
    const createdRule = await ruleRef.get();
    res.status(201).json({
      success: true,
      rule: serializeRule(ruleRef.id, createdRule.data())
    });
  } catch (error) {
    console.error('Create rule error:', error);
    res.status(500).json({ error: 'Failed to create rule', message: error.message });
  }
});

app.put('/api/tenants/:tenantId/rules/:ruleId', async (req, res) => {
  try {
    const ruleRef = db.collection('tenants').doc(req.params.tenantId)
      .collection('rules').doc(req.params.ruleId);
    const currentRule = await ruleRef.get();
    if (!currentRule.exists) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const updateData = getRulePayload(req.body);
    const completeRule = { ...currentRule.data(), ...updateData };
    const missingFields = getMissingRuleFields(completeRule);
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }

    updateData.updated_at = admin.firestore.FieldValue.serverTimestamp();
    await ruleRef.update(updateData);
    const updatedRule = await ruleRef.get();
    res.json({ success: true, rule: serializeRule(ruleRef.id, updatedRule.data()) });
  } catch (error) {
    console.error('Update rule error:', error);
    res.status(500).json({ error: 'Failed to update rule', message: error.message });
  }
});

app.delete('/api/tenants/:tenantId/rules/:ruleId', async (req, res) => {
  try {
    const ruleRef = db.collection('tenants').doc(req.params.tenantId)
      .collection('rules').doc(req.params.ruleId);
    const rule = await ruleRef.get();
    if (!rule.exists) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    await ruleRef.delete();
    res.json({ success: true, message: 'Rule deleted successfully' });
  } catch (error) {
    console.error('Delete rule error:', error);
    res.status(500).json({ error: 'Failed to delete rule', message: error.message });
  }
});

/**
 * ============================================
 * USER ACCOUNT ENDPOINTS
 * ============================================
 */

/**
 * POST /api/user-accounts
 * Create a new user account with associated tenant
 */
app.post('/api/user-accounts', async (req, res) => {
  try {
    const { email, displayName, photoURL, uid } = req.body;

    if (!email || !uid) {
      return res.status(400).json({
        error: 'Missing required fields: email, uid'
      });
    }

    // Use UID as tenant ID
    const tenantId = uid;
    
    // Use displayName as tenant name, fallback to email
    const defaultTenantName = displayName || email.split('@')[0];

    // Create tenant with UID
    const tenantData = {
      tenant_id: tenantId,
      name: defaultTenantName.trim(),
      email: email,
      active: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('tenants').doc(tenantId).set(tenantData, { merge: true });

    // Create user account using uid as document ID
    const userAccountData = {
      id: uid,
      email,
      displayName: displayName || '',
      photoURL: photoURL || '',
      uid,
      tenant_id: tenantId,
      balance: 0,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('user-accounts').doc(uid).set(userAccountData);

    res.status(201).json({
      success: true,
      message: 'User account created successfully',
      userAccount: userAccountData,
      tenant: { id: tenantId, ...tenantData }
    });
  } catch (error) {
    console.error('Create user account error:', error);
    res.status(500).json({
      error: 'Failed to create user account',
      message: error.message
    });
  }
});

/**
 * GET /api/user-accounts/:accountId
 * Get user account by ID
 */
app.get('/api/user-accounts/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;

    const accountDoc = await db.collection('user-accounts').doc(accountId).get();

    if (!accountDoc.exists) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const accountData = accountDoc.data();
    const tenantDoc = await db.collection('tenants').doc(accountData.tenant_id).get();

    res.json({
      success: true,
      userAccount: { id: accountId, ...accountData },
      tenant: tenantDoc.exists ? { id: accountData.tenant_id, ...tenantDoc.data() } : null
    });
  } catch (error) {
    console.error('Get user account error:', error);
    res.status(500).json({
      error: 'Failed to fetch user account',
      message: error.message
    });
  }
});

/**
 * GET /api/user-accounts/uid/:uid
 * Get user account by Firebase UID
 */
app.get('/api/user-accounts/uid/:uid', async (req, res) => {
  try {
    const { uid } = req.params;

    const snapshot = await db.collection('user-accounts').where('uid', '==', uid).limit(1).get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const accountDoc = snapshot.docs[0];
    const accountData = accountDoc.data();
    const tenantDoc = await db.collection('tenants').doc(accountData.tenant_id).get();

    res.json({
      success: true,
      userAccount: { id: accountDoc.id, ...accountData },
      tenant: tenantDoc.exists ? { id: accountData.tenant_id, ...tenantDoc.data() } : null
    });
  } catch (error) {
    console.error('Get user account by UID error:', error);
    res.status(500).json({
      error: 'Failed to fetch user account',
      message: error.message
    });
  }
});

/**
 * PUT /api/user-accounts/:accountId
 * Update user account
 */
app.put('/api/user-accounts/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { displayName, photoURL } = req.body;

    const updateData = {
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    if (displayName !== undefined) updateData.displayName = displayName;
    if (photoURL !== undefined) updateData.photoURL = photoURL;

    await db.collection('user-accounts').doc(accountId).update(updateData);

    const updatedDoc = await db.collection('user-accounts').doc(accountId).get();
    const accountData = updatedDoc.data();
    const tenantDoc = await db.collection('tenants').doc(accountData.tenant_id).get();

    res.json({
      success: true,
      message: 'User account updated successfully',
      userAccount: { id: accountId, ...accountData },
      tenant: tenantDoc.exists ? { id: accountData.tenant_id, ...tenantDoc.data() } : null
    });
  } catch (error) {
    console.error('Update user account error:', error);
    res.status(500).json({
      error: 'Failed to update user account',
      message: error.message
    });
  }
});

/**
 * GET /api/user-accounts/tenant/:tenantId
 * Get all user accounts for a tenant
 */
app.get('/api/user-accounts/tenant/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;

    const snapshot = await db.collection('user-accounts').where('tenant_id', '==', tenantId).get();
    const userAccounts = [];

    snapshot.forEach(doc => {
      userAccounts.push({ id: doc.id, ...doc.data() });
    });

    res.json({
      success: true,
      userAccounts
    });
  } catch (error) {
    console.error('Get tenant users error:', error);
    res.status(500).json({
      error: 'Failed to fetch tenant users',
      message: error.message
    });
  }
});

/**
 * DELETE /api/user-accounts/:accountId
 * Delete user account
 */
app.delete('/api/user-accounts/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;

    await db.collection('user-accounts').doc(accountId).delete();

    res.json({
      success: true,
      message: 'User account deleted successfully'
    });
  } catch (error) {
    console.error('Delete user account error:', error);
    res.status(500).json({
      error: 'Failed to delete user account',
      message: error.message
    });
  }
});

/**
 * POST /api/drive/share
 * Share files with service account
 */
app.post('/api/drive/share', async (req, res) => {
  try {
    const { fileId, fileName, role } = req.body;

    if (!fileId || !fileName) {
      return res.status(400).json({ 
        error: 'Missing required fields: fileId, fileName' 
      });
    }

    // This would integrate with Google Drive API
    // For now, just log the request
    console.log(`Sharing file ${fileName} (${fileId}) with role: ${role}`);

    res.json({ 
      success: true,
      message: 'File shared successfully',
      file: { fileId, fileName, role }
    });
  } catch (error) {
    console.error('Share error:', error);
    res.status(500).json({ 
      error: 'Share failed',
      message: error.message 
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Backend server is running'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   Backend Server Running Successfully  ║
╠════════════════════════════════════════╣
║ Port: ${PORT}                              ║
║ Environment: ${process.env.NODE_ENV || 'development'}          ║
║ Firebase Configured: ${Object.keys(serviceAccount).length > 0 ? 'Yes' : 'No'}            ║
╚════════════════════════════════════════╝
  `);
});

module.exports = app;
