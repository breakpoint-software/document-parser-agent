const admin = require('firebase-admin');
const { OAuth2Client } = require('google-auth-library');

function initializeServices() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

  if (!admin.apps.length) {
    if (!Object.keys(serviceAccount).length) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is required');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: 'https://dragonbotdb-fdda7-default-rtdb.firebaseio.com'
    });
  }

  return {
    admin,
    auth: admin.auth(),
    db: admin.firestore(),
    googleClient: new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'postmessage'
    ),
    firebaseConfigured: Object.keys(serviceAccount).length > 0
  };
}

module.exports = { initializeServices };