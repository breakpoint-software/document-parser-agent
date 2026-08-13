import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LucideCircleAlert, LucideCircleCheck, LucideLogOut, LucideShieldCheck } from '@lucide/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FirebaseAuthService, UserProfile } from '../../services/firebase-auth.service';
import { UserAccountService } from '../../services/user-account.service';
import { UserAccountCreateRequest } from '../../models';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    LucideCircleAlert,
    LucideCircleCheck,
    LucideLogOut,
    LucideShieldCheck,
  ],
  templateUrl: './signup.component.html'
})
export class SignupComponent implements OnInit, OnDestroy {
  currentUser: UserProfile | null = null;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  
  private destroy$ = new Subject<void>();

  constructor(
    private authService: FirebaseAuthService,
    private userAccountService: UserAccountService,
    private router: Router
  ) {}

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
          this.checkUserAccount(user.uid);
        }
      });

    this.authService.loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe(loading => {
        this.isLoading = loading;
      });
  }

  private checkUserAccount(uid: string): void {
    this.userAccountService.getUserAccountByUid(uid)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          const displayName = this.getString(this.currentUser?.displayName || this.currentUser?.email, 'User');
          this.successMessage = `Welcome back, ${displayName}!`;
          setTimeout(() => {
            this.router.navigate(['/dashboard', response.workspace_id]);
          }, 1500);
        },
        error: error => {
          if (error.status === 404) {
            this.autoCreateWorkspaceAndAccount();
          } else {
            this.errorMessage = 'Error checking account. Please try again.';
          }
        }
      });
  }

  /**
  * Auto-create workspace and user account with default data
   */
  private autoCreateWorkspaceAndAccount(): void {
    if (!this.currentUser) {
      this.errorMessage = 'User not authenticated';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

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
            this.router.navigate(['/dashboard', userAccount.workspace_id]);
          }, 1500);
        },
        error: (error) => {
          this.isLoading = false;
          console.error('Error creating workspace and account:', error);
          this.errorMessage = 'Failed to setup workspace. Please try again.';
        }
      });
  }

  continueWithGoogle(): void {
    this.errorMessage = '';
    this.successMessage = '';

    this.authService.signinWithGoogle()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.successMessage = 'Sign in successful!';
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
        },
        error: (error: any) => {
          this.errorMessage = 'Failed to logout: ' + (error?.message || 'Unknown error');
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
