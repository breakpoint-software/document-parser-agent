import { RUNTIME_CONFIG } from './runtime.config';

export const GOOGLE_CONFIG = {
  GOOGLE_CLIENT_ID: RUNTIME_CONFIG.googleClientId,
  GOOGLE_PICKER_API_KEY: RUNTIME_CONFIG.googlePickerApiKey,
  SERVICE_ACCOUNT_EMAIL: RUNTIME_CONFIG.googleServiceAccountEmail,

  // Scopes required for this app
  // Using drive.file keeps access scoped to files selected through the app.
  SCOPES: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/spreadsheets', // Access to Google Sheets
    'https://www.googleapis.com/auth/userinfo.email'   // User email access
  ],

  // Redirect URI (must match Google Cloud Console configuration)
  REDIRECT_URI: `${window.location.origin}/auth-callback`,

  // API Endpoints
  OAUTH_TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
  GOOGLE_AUTH_ENDPOINT: 'https://accounts.google.com/o/oauth2/v2/auth',
  DRIVE_API_URL: 'https://www.googleapis.com/drive/v3'
};

/**
 * Backend API Configuration
 * 
 * These endpoints should be hosted on your backend server
 * for secure token storage and exchange
 */
export const BACKEND_CONFIG = {
  API_BASE_URL: RUNTIME_CONFIG.apiBaseUrl,

  // Token storage endpoint (POST) - for securely storing refresh tokens
  TOKEN_STORAGE_ENDPOINT: '/auth/store-token',

  // Token refresh endpoint (POST) - for refreshing access tokens
  TOKEN_REFRESH_ENDPOINT: '/auth/refresh-token',

  // File sharing endpoint (POST) - for sharing files with Service Account
  FILE_SHARING_ENDPOINT: '/drive/share'
};
