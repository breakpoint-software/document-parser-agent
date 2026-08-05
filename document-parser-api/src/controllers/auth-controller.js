function createAuthController({ admin, auth, db, googleClient }) {
  async function upsertTenantForUser({ uid, email, displayName, photoURL, refreshToken }) {
    const tenantRef = db.collection('tenants').doc(uid);
    const tenantData = {
      tenant_id: uid,
      name: (displayName || email.split('@')[0]).trim(),
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

    await tenantRef.set(tenantData, { merge: true });
  }

  async function googleLogin(req, res) {
    try {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(503).json({ error: 'Backend Google OAuth credentials are not configured', code: 'OAUTH_CONFIG_MISSING' });
      }
      if (!req.body.code) {
        return res.status(400).json({ error: 'Missing required field: code' });
      }

      const { tokens } = await googleClient.getToken(req.body.code);
      if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token) {
        return res.status(400).json({
          error: 'Google did not return all required tokens. Revoke the existing app grant and consent again.',
          code: 'INCOMPLETE_GOOGLE_TOKENS'
        });
      }

      const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
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
        if (error.code !== 'auth/user-not-found') throw error;
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

      return res.json({
        success: true,
        customToken: await auth.createCustomToken(firebaseUser.uid),
        googleAccessToken: tokens.access_token
      });
    } catch (error) {
      console.error('Google authentication error:', error);
      return res.status(500).json({ error: 'Google authentication failed', message: error.message });
    }
  }

  async function getCurrentUser(req, res) {
    const tenantDoc = await db.collection('tenants').doc(req.user.uid).get();
    if (!tenantDoc.exists) return res.status(404).json({ error: 'User not found' });
    const tenant = tenantDoc.data();
    return res.json({
      success: true,
      user: { uid: req.user.uid, email: tenant.email, displayName: tenant.displayName, photoURL: tenant.photoURL },
      tenant: { id: req.user.uid, ...tenant }
    });
  }

  async function getAccessToken(req, res) {
    try {
      const tenantDoc = await db.collection('tenants').doc(req.user.uid).get();
      const refreshToken = tenantDoc.data()?.refresh_token;
      if (!refreshToken) return res.status(400).json({ error: 'No refresh token found. User must login again.', code: 'NO_REFRESH_TOKEN' });

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
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok) {
        const expired = tokens.error === 'invalid_grant';
        return res.status(expired ? 401 : tokenResponse.status).json({
          error: expired ? 'Refresh token expired. User must login again.' : 'Failed to refresh token',
          code: expired ? 'REFRESH_TOKEN_EXPIRED' : 'TOKEN_REFRESH_FAILED',
          message: tokens.error_description || tokens.error
        });
      }
      return res.json({ success: true, accessToken: tokens.access_token, expiresIn: tokens.expires_in, tokenType: tokens.token_type });
    } catch (error) {
      console.error('Get access token error:', error);
      return res.status(500).json({ error: 'Failed to get access token', message: error.message });
    }
  }

  return {
    googleLogin,
    getCurrentUser,
    getAccessToken,
    logout: (req, res) => res.json({ success: true, message: 'Logged out successfully' })
  };
}

module.exports = { createAuthController };