import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { GoogleAuthService, AuthState } from '../../services/google-auth.service';
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
  imports: [CommonModule, HttpClientModule],
  templateUrl: './google-auth.component.html',
  styleUrls: ['./google-auth.component.css']
})
export class GoogleAuthComponent implements OnInit, OnDestroy {
  authState: AuthState | null = null;

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
    private sharingService: GoogleDriveSharingService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // After Firebase login redirects here, automatically open the picker
    const accessToken = this.authService.getAccessToken();
    if (accessToken) {
      console.log('✅ User authenticated via Firebase, opening Google Picker...');
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
        console.log('✅ Items selected from picker:', items);
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
   * Get file display icon based on MIME type
   */
  getFileIcon(mimeType: string): string {
    if (!mimeType) return '📄';
    
    if (mimeType.includes('document')) return '📝';
    if (mimeType.includes('spreadsheet')) return '📊';
    if (mimeType.includes('presentation')) return '🎯';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('image')) return '🖼️';
    if (mimeType.includes('video')) return '🎬';
    if (mimeType.includes('audio')) return '🎵';
    if (mimeType.includes('archive') || mimeType.includes('zip')) return '📦';
    if (mimeType.includes('text')) return '📄';
    
    return '📄';
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
