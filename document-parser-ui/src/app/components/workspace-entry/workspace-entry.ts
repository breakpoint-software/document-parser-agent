import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LucideCircleAlert, LucideFileScan } from '@lucide/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FirebaseAuthService } from '../../services/firebase-auth.service';

@Component({
  selector: 'app-workspace-entry',
  imports: [CommonModule, MatButtonModule, MatProgressSpinnerModule, LucideCircleAlert, LucideFileScan],
  templateUrl: './workspace-entry.html',
})
export class WorkspaceEntry implements OnInit, OnDestroy {
  isLoading = true;
  errorMessage = '';
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly authService: FirebaseAuthService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.isLoading = false;
      });
  }

  signIn(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.authService.signinWithGoogle()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: user => void this.router.navigate(['/dashboard', user.uid]),
        error: error => {
          this.isLoading = false;
          this.errorMessage = error.message || 'Unable to sign in.';
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

}
