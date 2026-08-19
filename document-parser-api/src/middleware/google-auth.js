function createGoogleAuthMiddleware({ auth, googleClient }) {
  return async function requireGoogleAuth(req, res, next) {
    const authorization = req.get('authorization') || '';
    const [scheme, idToken] = authorization.split(' ');

    if (scheme !== 'Bearer' || !idToken) {
      return res.status(401).json({
        error: 'Firebase authorization is required',
        code: 'AUTH_REQUIRED'
      });
    }

    try {
      const decodedToken = await auth.verifyIdToken(idToken);
      
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified || false
      };
      return next();
    } catch (error) {
      console.error('Firebase authorization failed:', error.message);
      return res.status(401).json({
        error: 'Firebase ID token is invalid or expired',
        code: 'INVALID_AUTH_TOKEN'
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