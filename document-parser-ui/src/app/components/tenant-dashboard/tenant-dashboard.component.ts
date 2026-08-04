import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TenantService } from '../../services/tenant.service';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { TenantResponse } from '../../models';

@Component({
  selector: 'app-tenant-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tenant-dashboard.component.html',
  styleUrls: ['./tenant-dashboard.component.css']
})
export class TenantDashboardComponent implements OnInit, OnDestroy {
  tenant: TenantResponse | null = null;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  
  private destroy$ = new Subject<void>();
  private tenantId: string = '';

  constructor(
    private tenantService: TenantService,
    private authService: FirebaseAuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId') || '';

    if (!this.tenantId) {
      this.errorMessage = 'Invalid tenant ID';
      return;
    }

    this.loadTenant();
  }

  /**
   * Load tenant data
   */
  loadTenant(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.tenantService.getTenant(this.tenantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.tenant = response;
          this.isLoading = false;
        },
        error: (error) => {
          this.isLoading = false;
          console.error('Error loading tenant:', error);
          this.errorMessage = 'Failed to load tenant. Redirecting...';
          setTimeout(() => {
            this.router.navigate(['/signup']);
          }, 2000);
        }
      });
  }

  /**
   * Copy tenant ID to clipboard
   */
  copyTenantId(): void {
    if (this.tenant?.id) {
      navigator.clipboard.writeText(this.tenant.id).then(() => {
        this.successMessage = 'Tenant ID copied to clipboard!';
        setTimeout(() => {
          this.successMessage = '';
        }, 3000);
      });
    }
  }

  /**
   * Navigate to rules management
   */
  navigateToRules(): void {
    this.router.navigate(['/rules', this.tenantId]);
  }

  /**
   * Navigate to drive explorer
   */
  navigateToDriveExplorer(): void {
    this.router.navigate(['/drive-explorer']);
  }

  /**
   * Logout
   */
  logout(): void {
    this.authService.logout()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.router.navigate(['/signup']);
        },
        error: (error) => {
          this.errorMessage = 'Failed to logout: ' + error.message;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
