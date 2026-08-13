import { RUNTIME_CONFIG } from './runtime.config';

export const FIREBASE_CONFIG =  {
  apiKey: RUNTIME_CONFIG.firebaseApiKey,
  authDomain: RUNTIME_CONFIG.firebaseAuthDomain,
  databaseURL: RUNTIME_CONFIG.firebaseDatabaseUrl,
  projectId: RUNTIME_CONFIG.firebaseProjectId,
  storageBucket: RUNTIME_CONFIG.firebaseStorageBucket,
  messagingSenderId: RUNTIME_CONFIG.firebaseMessagingSenderId,
  appId: RUNTIME_CONFIG.firebaseAppId
};

export const BACKEND_API_CONFIG = {
  baseUrl: RUNTIME_CONFIG.apiBaseUrl
};
