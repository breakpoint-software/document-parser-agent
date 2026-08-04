import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { GoogleAuthService } from './google-auth.service';
import { GOOGLE_CONFIG } from '../config/google.config';

export interface SharePermission {
  kind: string;
  id: string;
  type: string;
  emailAddress: string;
  role: string;
}

export interface SharingResult {
  fileId: string;
  fileName: string;
  sharedWith: string;
  status: 'success' | 'error';
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class GoogleDriveSharingService {
  private readonly DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
  private readonly SERVICE_ACCOUNT_EMAIL = GOOGLE_CONFIG.SERVICE_ACCOUNT_EMAIL;

  constructor(
    private http: HttpClient,
    private authService: GoogleAuthService
  ) {
    console.log('GoogleDriveSharingService initialized with Service Account:', this.SERVICE_ACCOUNT_EMAIL);
  }

  /**
   * Step 4: Share item with Service Account
   */
  shareWithServiceAccount(
    fileId: string,
    fileName: string,
    role: 'reader' | 'writer' | 'commenter' = 'reader'
  ): Observable<SharingResult> {
    const accessToken = this.authService.getAccessToken();
    if (!accessToken) {
      return new Observable(observer => {
        console.error('❌ No access token available');
        observer.error('No access token available');
      });
    }

    const headers = new HttpHeaders({
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    });

    const permission = {
      type: 'user',
      role: role,
      emailAddress: this.SERVICE_ACCOUNT_EMAIL
    };

    const url = `${this.DRIVE_API_URL}/files/${fileId}/permissions?supportsAllDrives=true`;
    console.log(`🔄 Sharing file "${fileName}" with Service Account...`);

    return new Observable(observer => {
      this.http.post<SharePermission>(url, permission, { headers })
        .subscribe(
          (response) => {
            console.log(`✅ File "${fileName}" shared successfully`);
            const result: SharingResult = {
              fileId,
              fileName,
              sharedWith: this.SERVICE_ACCOUNT_EMAIL,
              status: 'success',
              message: `File "${fileName}" successfully shared with Service Account`
            };
            observer.next(result);
            observer.complete();
          },
          (error) => {
            console.error(`❌ Failed to share file "${fileName}":`, error);
            const result: SharingResult = {
              fileId,
              fileName,
              sharedWith: this.SERVICE_ACCOUNT_EMAIL,
              status: 'error',
              message: `Failed to share file: ${error.message}`
            };
            observer.next(result);
            observer.complete();
          }
        );
    });
  }

  /**
   * Share multiple files/folders with Service Account
   */
  shareMultipleWithServiceAccount(
    items: Array<{ id: string; name: string }>,
    role: 'reader' | 'writer' | 'commenter' = 'reader'
  ): Observable<SharingResult[]> {
    return new Observable(observer => {
      const results: SharingResult[] = [];
      let completed = 0;

      items.forEach(item => {
        this.shareWithServiceAccount(item.id, item.name, role)
          .subscribe(
            (result) => {
              results.push(result);
              completed++;
              if (completed === items.length) {
                observer.next(results);
                observer.complete();
              }
            },
            (error) => {
              results.push({
                fileId: item.id,
                fileName: item.name,
                sharedWith: this.SERVICE_ACCOUNT_EMAIL,
                status: 'error',
                message: error
              });
              completed++;
              if (completed === items.length) {
                observer.next(results);
                observer.complete();
              }
            }
          );
      });
    });
  }
}

