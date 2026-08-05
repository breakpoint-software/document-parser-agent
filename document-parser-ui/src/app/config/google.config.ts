/**
 * Google OAuth Configuration
 * 
 * Update these values with your Google Cloud Console credentials:
 * 1. Go to: https://console.cloud.google.com/
 * 2. Create a new project or select existing one
 * 3. Enable APIs: Google Drive API, Google Picker API
 * 4. Create OAuth 2.0 Credentials (Desktop/Web Application)
 * 5. Set Authorized JavaScript origins: http://localhost:4200
 * 6. Set Authorized redirect URIs: http://localhost:4200/auth-callback
 */

export const GOOGLE_CONFIG = {
  // OAuth Client ID from Google Cloud Console
  GOOGLE_CLIENT_ID: '1044306919042-96546hj5flikpto39hopt6f8d2hbgp93.apps.googleusercontent.com',

  // Google Picker API Key
  GOOGLE_PICKER_API_KEY: 'AIzaSyCiSHNqqTJeQ9bozaec65Qgx7CzFzWvBVk',

  // Service Account Email (for sharing files)
  // Create a Service Account in Google Cloud Console
  SERVICE_ACCOUNT_EMAIL: 'workbookupdate@dragonbotdb-fdda7.iam.gserviceaccount.com',

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
  // Backend API base URL
  API_BASE_URL: 'http://localhost:3000/api',

  // Token storage endpoint (POST) - for securely storing refresh tokens
  TOKEN_STORAGE_ENDPOINT: '/auth/store-token',

  // Token refresh endpoint (POST) - for refreshing access tokens
  TOKEN_REFRESH_ENDPOINT: '/auth/refresh-token',

  // File sharing endpoint (POST) - for sharing files with Service Account
  FILE_SHARING_ENDPOINT: '/drive/share'
};
