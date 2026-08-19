import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  Auth,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { FIREBASE_CONFIG, BACKEND_API_CONFIG } from '../config/firebase.config';
import { HttpClient } from '@angular/common/http';
import { GoogleAuthService } from './google-auth.service';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt?: Date;
}

export interface SignupData {
  email: string;
  password: string;
  displayName: string;
}

interface GoogleAuthResponse {
  customToken: string;
  googleAccessToken: string;
}

@Injectable({
  providedIn: 'root'
})
export class FirebaseAuthService {
  private auth: Auth;
  private readonly authStateReady: Promise<void>;
  private resolveAuthStateReady!: () => void;
  
  private currentUser = new BehaviorSubject<UserProfile | null>(null);
  currentUser$ = this.currentUser.asObservable();

  private isAuthenticated = new BehaviorSubject<boolean>(false);
  isAuthenticated$ = this.isAuthenticated.asObservable();

  private loading = new BehaviorSubject<boolean>(false);
  loading$ = this.loading.asObservable();

  constructor(
    private http: HttpClient,
    private googleAuthService: GoogleAuthService
  ) {
    // Initialize Firebase
    const app = initializeApp(FIREBASE_CONFIG);
    this.auth = getAuth(app);
    this.authStateReady = new Promise(resolve => {
      this.resolveAuthStateReady = resolve;
    });

    // Monitor auth state
    this.initializeAuthStateListener();
  }

  /**
   * Initialize auth state listener
   */
  private initializeAuthStateListener(): void {
    onAuthStateChanged(this.auth, (user: User | null) => {
      if (user) {
        const userProfile: UserProfile = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL
        };
        this.currentUser.next(userProfile);
        this.isAuthenticated.next(true);
      } else {
        this.currentUser.next(null);
        this.isAuthenticated.next(false);
      }

      this.resolveAuthStateReady();
    });
  }

  private async authenticateWithGoogle(): Promise<User> {
    const code = await this.googleAuthService.requestAuthorizationCode();
    const response = await firstValueFrom(this.http.post<GoogleAuthResponse>(
      `${BACKEND_API_CONFIG.baseUrl}/auth/google`,
      { code }
    ));

    this.googleAuthService.storeGoogleAccessToken(response.googleAccessToken);
    const credential = await signInWithCustomToken(this.auth, response.customToken);
    return credential.user;
  }

  /**
   * Sign up with Google (OAuth)
   */
  signupWithGoogle(): Observable<UserProfile> {
    return new Observable(observer => {
      this.loading.next(true);
      
      this.authenticateWithGoogle()
        .then((user) => {
          const userProfile: UserProfile = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            createdAt: new Date()
          };
          this.currentUser.next(userProfile);
          this.isAuthenticated.next(true);
          this.loading.next(false);
          observer.next(userProfile);
          observer.complete();
        })
        .catch((error) => {
          this.loading.next(false);
          console.error('Google signup error:', error);
          observer.error(error);
        });
    });
  }

  /**
   * Sign in with Google (OAuth)
   */
  signinWithGoogle(): Observable<UserProfile> {
    return new Observable(observer => {
      this.loading.next(true);
      
      this.authenticateWithGoogle()
        .then((user) => {
          const userProfile: UserProfile = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL
          };
          this.currentUser.next(userProfile);
          this.isAuthenticated.next(true);
          this.loading.next(false);
          observer.next(userProfile);
          observer.complete();
        })
        .catch((error) => {
          this.loading.next(false);
          console.error('Google signin error:', error);
          observer.error(error);
        });
    });
  }

  /**
   * Sign out
   */
  logout(): Observable<void> {
    return new Observable(observer => {
      this.loading.next(true);
      
      signOut(this.auth)
        .then(() => {
          this.currentUser.next(null);
          this.isAuthenticated.next(false);
          this.loading.next(false);
          observer.next();
          observer.complete();
        })
        .catch((error) => {
          this.loading.next(false);
          observer.error(error);
        });
    });
  }

  /**
   * Get current user
   */
  getCurrentUser(): UserProfile | null {
    return this.currentUser.value;
  }

  /**
   * Get auth token
   * First tries to get from Firebase Auth, falls back to sessionStorage/localStorage for testing
   */
  async getAuthToken(): Promise<string | null> {
    await this.authStateReady;

    const user = this.auth.currentUser;
    if (user) {
      return await user.getIdToken();
    }
    
    // Fallback for testing: check sessionStorage (injected during setup)
    let testToken = sessionStorage.getItem('access_token');
    if (testToken) {
      return testToken;
    }
    
    // Also check localStorage (persisted when Playwright restores auth state)
    testToken = localStorage.getItem('access_token');
    if (testToken) {
      return testToken;
    }
    
    return null;
  }

  /**
   * Check if user is authenticated
   */
  isUserAuthenticated(): boolean {
    return this.isAuthenticated.value;
  }
}
