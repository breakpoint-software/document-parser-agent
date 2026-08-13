function createGoogleAuthMiddleware({ auth, googleClient }) {
  return async function requireGoogleAuth(req, res, next) {
    const authorization = req.get('authorization') || '';
    const [scheme, accessToken] = authorization.split(' ');

    if (scheme !== 'Bearer' || !accessToken) {
      return res.status(401).json({
        error: 'Google authorization is required',
        code: 'GOOGLE_AUTH_REQUIRED'
      });
    }

    try {
      const tokenInfo = await googleClient.getTokenInfo(accessToken);
      if (!tokenInfo.email || tokenInfo.email_verified === false) {
        return res.status(401).json({
          error: 'Google token does not contain a verified email',
          code: 'INVALID_GOOGLE_TOKEN'
        });
      }

      const firebaseUser = await auth.getUserByEmail(tokenInfo.email);
      req.user = {
        uid: firebaseUser.uid,
        email: tokenInfo.email,
        googleToken: accessToken,
        scopes: tokenInfo.scopes || []
      };
      return next();
    } catch (error) {
      console.error('Google authorization failed:', error.message);
      return res.status(401).json({
        error: 'Google access token is invalid or expired',
        code: 'INVALID_GOOGLE_TOKEN'
      });
    }
  };
}

function requireOwnWorkspace(req, res, next) {
  const workspaceId = req.params.workspaceId;
  if (workspaceId !== req.user.uid) {
    return res.status(403).json({
      error: 'You do not have access to this workspace',
      code: 'WORKSPACE_ACCESS_DENIED'
    });
  }
  return next();
}

function requireOwnUser(req, res, next) {
  const requestedId = req.params.uid || req.params.accountId;
  if (requestedId && requestedId !== req.user.uid) {
    return res.status(403).json({
      error: 'You do not have access to this user account',
      code: 'USER_ACCESS_DENIED'
    });
  }
  return next();
}

module.exports = { createGoogleAuthMiddleware, requireOwnWorkspace, requireOwnUser };