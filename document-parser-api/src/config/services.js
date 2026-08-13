const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { OAuth2Client } = require('google-auth-library');

function initializeServices() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

  if (!getApps().length) {
    if (!Object.keys(serviceAccount).length) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is required');
    }

    initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://dragonbotdb-fdda7-default-rtdb.firebaseio.com'
    });
  }

  return {
    admin: { firestore: { FieldValue } },
    auth: getAuth(),
    db: getFirestore(),
    googleClient: new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'postmessage'
    ),
    firebaseConfigured: Object.keys(serviceAccount).length > 0
  };
}

module.exports = { initializeServices };