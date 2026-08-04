import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { GOOGLE_CONFIG } from '../config/google.config';

export interface AuthState {
  isAuthenticated: boolean;
  accessToken: string | null;
  userEmail: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class GoogleAuthService {
  private readonly GOOGLE_CLIENT_ID = GOOGLE_CONFIG.GOOGLE_CLIENT_ID;
  private readonly REDIRECT_URI = GOOGLE_CONFIG.REDIRECT_URI;
  private readonly SCOPES = GOOGLE_CONFIG.SCOPES;

  private authState = new BehaviorSubject<AuthState>({
    isAuthenticated: false,
    accessToken: null,
    userEmail: null
  });

  authState$ = this.authState.asObservable();
  private googleIdentityScript: Promise<void> | null = null;

  constructor() {
    this.loadTokenFromStorage();
    void this.loadGoogleIdentityServices();
    console.log('GoogleAuthService initialized with Client ID:', this.GOOGLE_CLIENT_ID);
    console.log('Redirect URI:', this.REDIRECT_URI);
  }

  /**
   * Step 1: Initiate Google OAuth flow - Redirect to auth URL
   */
  initiateGoogleAuth(): void {
    // Check if credentials are configured
    if (this.GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com' || 
        this.GOOGLE_CLIENT_ID.includes('YOUR_')) {
      console.error('❌ Google credentials not configured. Please update GOOGLE_CONFIG with your credentials.');
      alert('Google credentials not configured. Please check the console for setup instructions.');
      return;
    }

    console.log('🔵 Initiating Google OAuth flow...');
    const params = new URLSearchParams({
      client_id: this.GOOGLE_CLIENT_ID,
      redirect_uri: this.REDIRECT_URI,
      response_type: 'code',
      scope: this.SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent'
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    console.log('🔗 Redirecting to:', authUrl);
    window.location.href = authUrl;
  }

  requestAuthorizationCode(): Promise<string> {
    return this.loadGoogleIdentityServices().then(() => new Promise((resolve, reject) => {
      const codeClient = (window as any).google.accounts.oauth2.initCodeClient({
        client_id: this.GOOGLE_CLIENT_ID,
        scope: this.SCOPES.join(' '),
        ux_mode: 'popup',
        access_type: 'offline',
        callback: (response: { code?: string; error?: string }) => {
          if (response.code) {
            resolve(response.code);
          } else {
            reject(new Error(response.error || 'Google authorization did not return a code'));
          }
        },
        error_callback: (error: { type?: string }) => {
          reject(new Error(error.type || 'Google authorization popup failed'));
        }
      });

      codeClient.requestCode({
        access_type: 'offline',
        prompt: 'consent'
      });
    }));
  }

  private loadGoogleIdentityServices(): Promise<void> {
    if ((window as any).google?.accounts?.oauth2) {
      return Promise.resolve();
    }

    if (!this.googleIdentityScript) {
      this.googleIdentityScript = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
        document.head.appendChild(script);
      });
    }

    return this.googleIdentityScript;
  }

  /**
   * Store Google access token obtained from Firebase
   * This method is called after Firebase OAuth popup completes
   */
  storeGoogleAccessToken(accessToken: string): void {
    const state: AuthState = {
      isAuthenticated: true,
      accessToken: accessToken,
      userEmail: this.authState.value.userEmail
    };

    this.authState.next(state);
    sessionStorage.setItem('access_token', accessToken);
    console.log('✅ Google access token stored successfully');
  }

  /**
   * Load token from storage on service initialization
   */
  private loadTokenFromStorage(): void {
    const token = sessionStorage.getItem('access_token');
    if (token) {
      const state: AuthState = {
        isAuthenticated: true,
        accessToken: token,
        userEmail: null
      };
      this.authState.next(state);
    }
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    return this.authState.value.accessToken;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.authState.value.isAuthenticated;
  }

  /**
   * Logout - clear tokens
   */
  logout(): void {
    sessionStorage.removeItem('access_token');
    const state: AuthState = {
      isAuthenticated: false,
      accessToken: null,
      userEmail: null
    };
    this.authState.next(state);
  }
}
