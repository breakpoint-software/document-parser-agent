import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, from, Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { GoogleAuthService } from './google-auth.service';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class GoogleDriveService {
  private readonly DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';

  constructor(
    private http: HttpClient,
    private authService: GoogleAuthService
  ) {}

  /**
   * List files in a Google Drive folder
   * @param folderId - The ID of the folder
   * @param pageSize - Maximum number of files to return (default: 50)
   */
  listFilesInFolder(folderId: string, pageSize: number = 50): Observable<any> {
    const accessToken = this.authService.getAccessToken();
    if (!accessToken) {
      return throwError(() => new Error('No access token available'));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`
    });

    // Query to find files in the specified folder
    const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const fields = 'files(id,name,mimeType,webViewLink,createdTime,modifiedTime,size)';
    
    const url = `${this.DRIVE_API_URL}?q=${query}&fields=${fields}&pageSize=${pageSize}`;

    return this.http.get(url, { headers }).pipe(
      catchError(error => {
        console.error('Error listing files in Google Drive folder:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Get file metadata
   * @param fileId - The ID of the file
   */
  getFileMetadata(fileId: string): Observable<any> {
    const accessToken = this.authService.getAccessToken();
    if (!accessToken) {
      return throwError(() => new Error('No access token available'));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`
    });

    const fields = 'id,name,mimeType,parents,webViewLink,createdTime,modifiedTime,size,owners,permissions';
    const url = `${this.DRIVE_API_URL}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${fields}`;

    return this.http.get(url, { headers }).pipe(
      catchError(error => {
        console.error('Error getting file metadata:', error);
        return throwError(() => error);
      })
    );
  }

  getFullPath(fileId: string): Observable<string> {
    return from(this.resolveFullPath(fileId));
  }

  private async resolveFullPath(fileId: string): Promise<string> {
    const pathParts: string[] = [];
    const visitedIds = new Set<string>();
    let currentId: string | undefined = fileId;

    while (currentId && !visitedIds.has(currentId) && pathParts.length < 100) {
      visitedIds.add(currentId);
      const file = await firstValueFrom(this.getFileMetadata(currentId)) as DriveFile;
      pathParts.unshift(file.name);
      currentId = file.parents?.[0];
    }

    return `/${pathParts.join('/')}`;
  }

  /**
   * Search for files in Google Drive
   * @param query - Search query
   * @param pageSize - Maximum number of files to return
   */
  searchFiles(query: string, pageSize: number = 50): Observable<any> {
    const accessToken = this.authService.getAccessToken();
    if (!accessToken) {
      return throwError(() => new Error('No access token available'));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`
    });

    const encodedQuery = encodeURIComponent(query);
    const fields = 'files(id,name,mimeType,webViewLink,createdTime,modifiedTime,size)';
    
    const url = `${this.DRIVE_API_URL}?q=${encodedQuery}&fields=${fields}&pageSize=${pageSize}`;

    return this.http.get(url, { headers }).pipe(
      catchError(error => {
        console.error('Error searching Google Drive:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Upload file to Google Drive
   * @param file - File to upload
   * @param parentFolderId - Optional parent folder ID
   */
  uploadFile(file: File, parentFolderId?: string): Observable<any> {
    const accessToken = this.authService.getAccessToken();
    if (!accessToken) {
      return throwError(() => new Error('No access token available'));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`
    });

    const formData = new FormData();
    
    const metadata = {
      name: file.name,
      ...(parentFolderId && { parents: [parentFolderId] })
    };
    
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', file);

    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    return this.http.post(url, formData, { headers }).pipe(
      catchError(error => {
        console.error('Error uploading file to Google Drive:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Delete a file from Google Drive
   * @param fileId - The ID of the file to delete
   */
  deleteFile(fileId: string): Observable<any> {
    const accessToken = this.authService.getAccessToken();
    if (!accessToken) {
      return throwError(() => new Error('No access token available'));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`
    });

    const url = `${this.DRIVE_API_URL}/${fileId}`;

    return this.http.delete(url, { headers }).pipe(
      catchError(error => {
        console.error('Error deleting file from Google Drive:', error);
        return throwError(() => error);
      })
    );
  }
}
