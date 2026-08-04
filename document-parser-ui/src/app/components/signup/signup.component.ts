import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FirebaseAuthService, UserProfile } from '../../services/firebase-auth.service';
import { UserAccountService } from '../../services/user-account.service';
import { UserAccountCreateRequest } from '../../models';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.css']
})
export class SignupComponent implements OnInit, OnDestroy {
  currentUser: UserProfile | null = null;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  showTenantForm = false;
  tenantName = '';
  
  private destroy$ = new Subject<void>();

  constructor(
    private authService: FirebaseAuthService,
    private userAccountService: UserAccountService,
    private router: Router
  ) {}

  /**
   * Check if tenant name is valid and not empty
   */
  get isTenantNameValid(): boolean {
    return this.tenantName.trim().length > 0;
  }

  /**
   * Safe string conversion helper
   */
  private getString(value: string | null | undefined, defaultValue: string = ''): string {
    return typeof value === 'string' ? value : defaultValue;
  }

  ngOnInit(): void {
    // Subscribe to current user
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
        if (user) {
          // Check if user already has an account
          this.checkUserAccount(user.uid);
        }
      });

    // Subscribe to loading state
    this.authService.loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe(loading => {
        this.isLoading = loading;
      });
  }

  /**
   * Check if user already has an account
   */
  private checkUserAccount(uid: string): void {
    this.userAccountService.getUserAccountByUid(uid)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          // User already has an account, redirect to dashboard
          const displayName = this.getString(this.currentUser?.displayName || this.currentUser?.email, 'User');
          this.successMessage = `Welcome back, ${displayName}!`;
          setTimeout(() => {
            this.router.navigate(['/dashboard', response.tenant_id]);
          }, 1500);
        },
        error: (error) => {
          // User is new, auto-create tenant with default data
          if (error.status === 404) {
            this.autoCreateTenantAndAccount();
          } else {
            this.errorMessage = 'Error checking account. Please try again.';
          }
        }
      });
  }

  /**
   * Auto-create tenant and user account with default data
   */
  private autoCreateTenantAndAccount(): void {
    if (!this.currentUser) {
      this.errorMessage = 'User not authenticated';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    // Use user's display name or email as default workspace name
    const defaultWorkspaceName = this.getString(
      this.currentUser?.displayName,
      this.currentUser?.email?.split('@')[0] || 'My Workspace'
    );

    const userData: UserAccountCreateRequest = {
      email: this.currentUser?.email,
      displayName: this.currentUser?.displayName,
      photoURL: this.currentUser?.photoURL,
      uid: this.currentUser!.uid
    };

    this.userAccountService.createUserAccount(userData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (userAccount) => {
          this.isLoading = false;
          const displayName = this.getString(this.currentUser?.displayName || this.currentUser?.email, 'User');
          this.successMessage = `Welcome, ${displayName}! Setting up your workspace...`;
          setTimeout(() => {
            this.router.navigate(['/dashboard', userAccount.tenant_id]);
          }, 1500);
        },
        error: (error) => {
          this.isLoading = false;
          console.error('Error creating tenant and account:', error);
          this.errorMessage = 'Failed to setup workspace. Please try again.';
        }
      });
  }

  /**
   * Sign up with Google
   */
  signupWithGoogle(): void {
    this.errorMessage = '';
    this.successMessage = '';
    
    this.authService.signupWithGoogle()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (user) => {
          this.successMessage = 'Signup successful! Please create your workspace...';
        },
        error: (error) => {
          console.error('Signup error:', error);
          if (error.code === 'auth/popup-closed-by-user') {
            this.errorMessage = 'Signup cancelled by user';
          } else if (error.code === 'auth/network-request-failed') {
            this.errorMessage = 'Network error. Please check your connection.';
          } else {
            this.errorMessage = error.message || 'Failed to sign up. Please try again.';
          }
        }
      });
  }

  /**
   * Sign in with Google
   */
  signinWithGoogle(): void {
    this.errorMessage = '';
    this.successMessage = '';
    
    this.authService.signinWithGoogle()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (user) => {
          this.successMessage = 'Sign in successful!';
          // The checkUserAccount method will be called via the currentUser$ subscription
        },
        error: (error) => {
          console.error('Sign in error:', error);
          if (error.code === 'auth/popup-closed-by-user') {
            this.errorMessage = 'Sign in cancelled by user';
          } else if (error.code === 'auth/network-request-failed') {
            this.errorMessage = 'Network error. Please check your connection.';
          } else {
            this.errorMessage = error.message || 'Failed to sign in. Please try again.';
          }
        }
      });
  }

  /**
   * Logout
   */
  logout(): void {
    this.authService.logout()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.successMessage = 'Logged out successfully';
          this.currentUser = null;
          this.showTenantForm = false;
          this.tenantName = '';
        },
        error: (error: any) => {
          this.errorMessage = 'Failed to logout: ' + (error?.message || 'Unknown error');
        }
      });
  }

  createTenantAndAccount(): void {
    if (!this.tenantName.trim()) {
      this.errorMessage = 'Please enter a workspace name';
      return;
    }

    if (!this.currentUser) {
      this.errorMessage = 'User not authenticated';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const userData: UserAccountCreateRequest = {
      email: this.currentUser?.email,
      displayName: this.currentUser?.displayName || this.tenantName,
      photoURL: this.currentUser?.photoURL,
      uid: this.currentUser!.uid
    };

    this.userAccountService.createUserAccount(userData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (userAccount) => {
          this.isLoading = false;
          this.successMessage = `Workspace created successfully! Redirecting...`;
          setTimeout(() => {
            this.showTenantForm = false;
            this.router.navigate(['/dashboard', userAccount.tenant_id]);
          }, 1500);
        },
        error: (error) => {
          this.isLoading = false;
          console.error('Error creating tenant/account:', error);
          this.errorMessage = error.error?.message || 'Failed to create workspace. Please try again.';
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
