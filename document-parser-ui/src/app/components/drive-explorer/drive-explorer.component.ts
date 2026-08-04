import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { FirebaseAuthService, UserProfile } from '../../services/firebase-auth.service';
import { GooglePickerService, PickedItem } from '../../services/google-picker.service';
import { GoogleAuthService, AuthState } from '../../services/google-auth.service';

export interface DriveExplorerState {
  selectedItems: PickedItem[];
  isLoading: boolean;
  errorMessage: string | null;
  successMessage: string | null;
}

@Component({
  selector: 'app-drive-explorer',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './drive-explorer.component.html',
  styleUrls: ['./drive-explorer.component.css']
})
export class DriveExplorerComponent implements OnInit, OnDestroy {
  currentUser: UserProfile | null = null;
  authState: AuthState | null = null;

  explorerState: DriveExplorerState = {
    selectedItems: [],
    isLoading: false,
    errorMessage: null,
    successMessage: null
  };

  private destroy$ = new Subject<void>();

  constructor(
    private firebaseAuthService: FirebaseAuthService,
    private googleAuthService: GoogleAuthService,
    private pickerService: GooglePickerService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Subscribe to current user
    this.firebaseAuthService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
        if (!user) {
          // Redirect to signup if not authenticated
          this.router.navigate(['/signup']);
        }
      });

    // Subscribe to Google auth state
    this.googleAuthService.authState$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => {
        this.authState = state;
        console.log('🔵 Google auth state updated:', state);
        
        // If auth state becomes available and we haven't opened picker yet
        if (state.isAuthenticated && state.accessToken && this.explorerState.selectedItems.length === 0) {
          // Open picker after a brief delay to let UI settle
          setTimeout(() => this.openDrivePicker(), 1000);
        }
      });

    // Subscribe to selected items from picker service
    this.pickerService.selectedItems$
      .pipe(takeUntil(this.destroy$))
      .subscribe(items => {
        this.explorerState.selectedItems = items;
      });

    console.log('DriveExplorerComponent initialized');
  }

  /**
   * Open Google Picker to explore and select files/folders from Google Drive
   */
  openDrivePicker(): void {
    const accessToken = this.googleAuthService.getAccessToken();
    
    if (!accessToken) {
      const errorMsg = 'No Google Drive access. Your Google authentication token is not available. Please sign out and sign up again to enable Google Drive access.';
      console.error('❌', errorMsg);
      console.log('Current auth state:', this.authState);
      this.explorerState.errorMessage = errorMsg;
      return;
    }

    this.explorerState.isLoading = true;
    this.explorerState.errorMessage = null;
    this.explorerState.successMessage = null;

    console.log('📂 Opening Google Picker...');

    this.pickerService.openPicker(accessToken)
      .then((items) => {
        console.log('✅ Items selected from Google Drive:', items);
        this.explorerState.selectedItems = items;
        this.explorerState.isLoading = false;
        this.explorerState.successMessage = `Successfully selected ${items.length} item(s) from your Google Drive`;
        
        // Auto-dismiss success message after 3 seconds
        setTimeout(() => {
          this.explorerState.successMessage = null;
        }, 3000);
      })
      .catch((error) => {
        console.error('❌ Error opening picker:', error);
        this.explorerState.isLoading = false;
        this.explorerState.errorMessage = `Failed to open Google Drive Picker: ${error}`;
      });
  }

  /**
   * Clear selected items and open picker again
   */
  clearSelection(): void {
    this.explorerState.selectedItems = [];
    this.explorerState.successMessage = null;
    this.openDrivePicker();
  }

  /**
   * Export selected items info (for debugging/testing)
   */
  exportSelection(): void {
    const data = {
      timestamp: new Date().toISOString(),
      user: this.currentUser?.email,
      selectedItems: this.explorerState.selectedItems.map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        mimeType: item.mimeType
      }))
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drive-selection-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    this.explorerState.successMessage = 'Selection exported successfully';
    setTimeout(() => {
      this.explorerState.successMessage = null;
    }, 3000);
  }

  /**
   * Get appropriate icon for file based on MIME type
   */
  getFileIcon(mimeType: string | null | undefined): string {
    if (!mimeType) return '📄';
    
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎥';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('spreadsheet') || mimeType.includes('sheet')) return '📊';
    if (mimeType.includes('document') || mimeType.includes('word')) return '📄';
    if (mimeType.includes('presentation')) return '📈';
    if (mimeType.includes('folder')) return '📁';
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return '🗜️';
    
    return '📄';
  }

  /**
   * Logout and redirect to signup
   */
  logout(): void {
    this.firebaseAuthService.logout()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.explorerState.successMessage = 'Logged out successfully';
          setTimeout(() => {
            this.router.navigate(['/signup']);
          }, 1000);
        },
        error: (error) => {
          this.explorerState.errorMessage = 'Failed to logout: ' + error.message;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
