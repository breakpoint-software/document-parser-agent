export interface RuntimeConfig {
  apiBaseUrl: string;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseDatabaseUrl: string;
  firebaseProjectId: string;
  firebaseStorageBucket: string;
  firebaseMessagingSenderId: string;
  firebaseAppId: string;
  googleClientId: string;
  googlePickerApiKey: string;
  googleServiceAccountEmail: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeConfig;
  }
}

export const RUNTIME_CONFIG: RuntimeConfig = window.__APP_CONFIG__ ?? {
  apiBaseUrl: 'http://localhost:3000/api',
  firebaseApiKey: '',
  firebaseAuthDomain: '',
  firebaseDatabaseUrl: '',
  firebaseProjectId: '',
  firebaseStorageBucket: '',
  firebaseMessagingSenderId: '',
  firebaseAppId: '',
  googleClientId: '',
  googlePickerApiKey: '',
  googleServiceAccountEmail: ''
};