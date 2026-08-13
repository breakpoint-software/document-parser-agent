import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LucideCircleAlert, LucideCircleCheck, LucideFile, LucideFolder, LucideRotateCcw, LucideShare2 } from '@lucide/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { GoogleAuthService } from '../../services/google-auth.service';
import { GooglePickerService, PickedItem } from '../../services/google-picker.service';
import { GoogleDriveSharingService, SharingResult } from '../../services/google-drive-sharing.service';

export interface UIState {
  currentStep: 'auth' | 'picker' | 'sharing' | 'complete';
  authStatus: string;
  selectedItems: PickedItem[];
  sharingResults: SharingResult[];
  isLoading: boolean;
  errorMessage: string | null;
}

@Component({
  selector: 'app-google-auth',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatListModule,
    MatProgressSpinnerModule,
    LucideCircleAlert,
    LucideCircleCheck,
    LucideFile,
    LucideFolder,
    LucideRotateCcw,
    LucideShare2
  ],
  templateUrl: './google-auth.component.html'
})
export class GoogleAuthComponent implements OnInit, OnDestroy {
  uiState: UIState = {
    currentStep: 'auth',
    authStatus: 'Not authenticated',
    selectedItems: [],
    sharingResults: [],
    isLoading: false,
    errorMessage: null
  };

  private destroy$ = new Subject<void>();

  constructor(
    private authService: GoogleAuthService,
    private pickerService: GooglePickerService,
    private sharingService: GoogleDriveSharingService
  ) {}

  ngOnInit(): void {
    // After Firebase login redirects here, automatically open the picker
    const accessToken = this.authService.getAccessToken();
    if (accessToken) {
      setTimeout(() => this.autoOpenGooglePicker(), 500);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Automatically open Google Picker after Firebase authentication
   */
  private autoOpenGooglePicker(): void {
    const accessToken = this.authService.getAccessToken();
    
    if (!accessToken) {
      this.uiState.errorMessage = 'No access token available';
      return;
    }

    this.uiState.isLoading = true;
    this.uiState.currentStep = 'picker';
    this.uiState.authStatus = 'Opening Google Drive Picker...';

    this.pickerService.openPicker(accessToken)
      .then((items) => {
        this.uiState.selectedItems = items;
        this.uiState.isLoading = false;
        this.uiState.currentStep = 'sharing';
        this.uiState.authStatus = `Selected ${items.length} item(s)`;
      })
      .catch((error) => {
        console.error('❌ Picker error:', error);
        this.uiState.isLoading = false;
        this.uiState.errorMessage = `Failed to open picker: ${error}`;
      });
  }

  /**
   * Step 4: Share selected items with Service Account
   */
  shareWithServiceAccount(): void {
    if (this.uiState.selectedItems.length === 0) {
      this.uiState.errorMessage = 'No items selected';
      return;
    }

    this.uiState.isLoading = true;
    this.uiState.authStatus = 'Sharing items with Service Account...';

    const itemsToShare = this.uiState.selectedItems.map(item => ({
      id: item.id,
      name: item.name
    }));

    this.sharingService.shareMultipleWithServiceAccount(itemsToShare, 'reader')
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        (results) => {
          this.uiState.sharingResults = results;
          this.uiState.isLoading = false;
          this.uiState.currentStep = 'complete';
          this.uiState.authStatus = 'Successfully shared all items!';
        },
        (error) => {
          this.uiState.isLoading = false;
          this.uiState.errorMessage = `Failed to share items: ${error}`;
        }
      );
  }

  /**
   * Reset the flow and start over
   */
  reset(): void {
    this.authService.logout();
    this.uiState = {
      currentStep: 'auth',
      authStatus: 'Not authenticated',
      selectedItems: [],
      sharingResults: [],
      isLoading: false,
      errorMessage: null
    };
  }

  /**
   * Get step display name
   */
  getStepTitle(): string {
    const titles: { [key: string]: string } = {
      auth: 'Step 1: User Authentication & Authorization',
      picker: 'Step 2: Drive Navigation & File Selection',
      sharing: 'Step 3: Share with Service Account',
      complete: 'Step 4: Sharing Complete'
    };
    return titles[this.uiState.currentStep] || '';
  }
}
