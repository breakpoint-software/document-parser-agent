import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  LucideBookOpen,
  LucideCircleAlert,
  LucideCircleCheck,
  LucideCircleX,
  LucideExternalLink,
  LucideFileSpreadsheet,
  LucideFileText,
  LucideFolderOpen,
  LucideInfo,
  LucideListChecks,
  LucideListPlus,
  LucidePaperclip,
  LucidePenLine,
  LucideRefreshCw,
  LucideSearch,
  LucideTrash2
} from '@lucide/angular';
import { GoogleSheetsService } from '../../services/google-sheets.service';
import { GoogleDriveService, DriveFile } from '../../services/google-drive.service';
import { GoogleAuthService } from '../../services/google-auth.service';

interface TestResult {
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
  timestamp: Date;
}

@Component({
  selector: 'app-test-oauth',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    LucideBookOpen,
    LucideCircleAlert,
    LucideCircleCheck,
    LucideCircleX,
    LucideExternalLink,
    LucideFileSpreadsheet,
    LucideFileText,
    LucideFolderOpen,
    LucideInfo,
    LucideListChecks,
    LucideListPlus,
    LucidePaperclip,
    LucidePenLine,
    LucideRefreshCw,
    LucideSearch,
    LucideTrash2
  ],
  templateUrl: './test-oauth.component.html'
})
export class TestOAuthComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  // Test configuration
  readonly SPREADSHEET_ID = '1YhmRraDrebM0566fcIx7_4HZ1OrI-9Jxk1lw5p9Ienw';
  readonly SHEET_NAME = 'Sheet1';
  readonly FOLDER_ID = '1oH_-rVoYyo6FJ3I8hBFQFOOi1Jx1HcTZ';

  // State management
  isAuthenticated = false;
  isLoading = false;
  testResults: TestResult[] = [];
  driveFiles: DriveFile[] = [];
  sheetData: unknown[][] = [];
  errorMessage = '';

  constructor(
    private sheetsService: GoogleSheetsService,
    private driveService: GoogleDriveService,
    private authService: GoogleAuthService
  ) {}

  ngOnInit(): void {
    // Check both authService state AND sessionStorage for token
    this.authService.authState$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(state => {
        this.isAuthenticated = state.isAuthenticated;
      });
    
    // Also check if access token exists in sessionStorage
    const hasToken = !!sessionStorage.getItem('access_token');
    if (hasToken && !this.isAuthenticated) {
      this.isAuthenticated = true;
    }
  }

  /**
   * Test auth token validity by checking Google API directly
   */
  testTokenValidity(): void {
    if (!this.isAuthenticated) {
      this.addResult('error', 'Not authenticated', 'Please log in first');
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    // Test with a simple Sheets API call to get metadata
    // Try without quotes first - let's see if the sheet name exists
    const range = `${this.SHEET_NAME}!A1`;
    this.sheetsService.readFromSheet(this.SPREADSHEET_ID, range).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.addResult(
          'success',
          'Token Validity Test',
          `Token has proper scopes and the sheet is accessible. Data: ${JSON.stringify(response.values || [])}`
        );
      },
      error: (error) => {
        this.isLoading = false;
        console.error('❌ Token validity error:', error);
        this.addResult(
          'error',
          'Token Validity Test',
          `Cannot access sheet. Error: ${error.message}. Please verify:
           1. Spreadsheet ID is correct (from sheet URL)
           2. Sheet name "Libro" exists in the spreadsheet
           3. Your Google account has access to this sheet`
        );
      }
    });
  }

  /**
   * Test 1: Write data to Google Sheet
   */
  testWriteToSheet(): void {
    if (!this.isAuthenticated) {
      this.addResult('error', 'Not authenticated', 'Please log in first');
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const timestamp = new Date().toLocaleString();

    // Prepare test data - write to row 1
    const testData = [
      ['Test Time', 'Status', 'Message'],
      [timestamp, 'SUCCESS', 'OAuth test write to Google Sheet']
    ];

    const range = `${this.SHEET_NAME}!A1:C2`;

    this.sheetsService.writeToSheet(this.SPREADSHEET_ID, range, testData).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.addResult(
          'success',
          'Write to Google Sheet',
          `Successfully wrote ${response.updatedCells} cells to the sheet at ${timestamp}`
        );
      },
      error: (error) => {
        this.isLoading = false;
        console.error('Error writing to sheet:', error);
        this.errorMessage = error.message || 'Error writing to sheet';
        this.addResult('error', 'Write to Google Sheet', this.errorMessage);
      }
    });
  }

  /**
   * Test 2: Append data to Google Sheet
   */
  testAppendToSheet(): void {
    if (!this.isAuthenticated) {
      this.addResult('error', 'Not authenticated', 'Please log in first');
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const timestamp = new Date().toLocaleString();

    // Append data to next available row
    const testData = [
      [timestamp, 'APPENDED', 'New row appended to Google Sheet']
    ];

    const range = `${this.SHEET_NAME}!A:C`;

    this.sheetsService.appendToSheet(this.SPREADSHEET_ID, range, testData).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.addResult(
          'success',
          'Append to Google Sheet',
          `Successfully appended row at ${response.updates.updatedRange}`
        );
      },
      error: (error) => {
        this.isLoading = false;
        console.error('Error appending to sheet:', error);
        this.errorMessage = error.message || 'Error appending to sheet';
        this.addResult('error', 'Append to Google Sheet', this.errorMessage);
      }
    });
  }

  /**
   * Test 2b: Batch update data to Google Sheet (VERIFIED WORKING)
   */
  testBatchUpdateSheet(): void {
    if (!this.isAuthenticated) {
      this.addResult('error', 'Not authenticated', 'Please log in first');
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const timestamp = new Date().toLocaleString();

    // Batch update data - write to single cell or range
    const testData = [
      ['Batch Update Test', timestamp, 'SUCCESS']
    ];

    const range = `${this.SHEET_NAME}!A1`;

    this.sheetsService.batchUpdateSheet(this.SPREADSHEET_ID, range, testData).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.addResult(
          'success',
          'Batch Update Google Sheet',
          `Successfully batch updated ${response.totalUpdatedCells} cells in the sheet`
        );
      },
      error: (error) => {
        this.isLoading = false;
        console.error('Error batch updating sheet:', error);
        this.errorMessage = error.message || 'Error batch updating sheet';
        this.addResult('error', 'Batch Update Google Sheet', this.errorMessage);
      }
    });
  }

  /**
   * Test 3: Read data from Google Sheet
   */
  testReadFromSheet(): void {
    if (!this.isAuthenticated) {
      this.addResult('error', 'Not authenticated', 'Please log in first');
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const range = `${this.SHEET_NAME}!A:C`;

    this.sheetsService.readFromSheet(this.SPREADSHEET_ID, range).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.sheetData = response.values || [];
        this.addResult(
          'success',
          'Read from Google Sheet',
          `Successfully read ${this.sheetData.length} rows from the sheet`
        );
      },
      error: (error) => {
        this.isLoading = false;
        console.error('Error reading from sheet:', error);
        this.errorMessage = error.message || 'Error reading from sheet';
        this.addResult('error', 'Read from Google Sheet', this.errorMessage);
      }
    });
  }

  /**
   * Test 4: List files in Google Drive folder
   */
  testListFilesInFolder(): void {
    if (!this.isAuthenticated) {
      this.addResult('error', 'Not authenticated', 'Please log in first');
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    this.driveService.listFilesInFolder(this.FOLDER_ID).subscribe({
      next: (response) => {
        this.isLoading = false;
        this.driveFiles = response.files || [];
        this.addResult(
          'success',
          'List Files in Google Drive Folder',
          `Successfully retrieved ${this.driveFiles.length} files from folder`
        );
      },
      error: (error) => {
        this.isLoading = false;
        console.error('Error listing files:', error);
        this.errorMessage = error.message || 'Error listing files';
        this.addResult('error', 'List Files in Google Drive Folder', this.errorMessage);
      }
    });
  }

  /**
   * Helper method to add test results
   */
  private addResult(type: 'success' | 'error' | 'info', title: string, message: string): void {
    this.testResults.unshift({
      type,
      title,
      message,
      timestamp: new Date()
    });
    // Keep only last 10 results
    if (this.testResults.length > 10) {
      this.testResults.pop();
    }
  }

  /**
   * Clear test results
   */
  clearResults(): void {
    this.testResults = [];
    this.driveFiles = [];
    this.sheetData = [];
    this.errorMessage = '';
  }

  /**
   * Clear stored token and force re-authentication
   */
  clearTokenAndRelogin(): void {
    sessionStorage.removeItem('access_token');
    this.authService.logout();
    this.testResults = [];
    this.addResult(
      'info',
      'Token Cleared',
      'Access token has been cleared from session storage. Please sign in again to get a fresh token with all required scopes.'
    );
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: string | undefined): string {
    if (!bytes) return 'N/A';
    const size = parseInt(bytes, 10);
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let fileSize = size;
    while (fileSize >= 1024 && unitIndex < units.length - 1) {
      fileSize /= 1024;
      unitIndex++;
    }
    return `${fileSize.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Format date for display
   */
  formatDate(dateString: string | undefined): string {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  }
}
