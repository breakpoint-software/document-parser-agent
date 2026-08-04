import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { GoogleAuthService } from './google-auth.service';

@Injectable({
  providedIn: 'root'
})
export class GoogleSheetsService {
  private readonly SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
  private readonly REQUIRED_SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ];

  constructor(
    private http: HttpClient,
    private authService: GoogleAuthService
  ) {}

  /**
   * Decode JWT token and extract scopes
   */
  private decodeToken(token: string): any {
    try {
      console.log('🔍 Attempting to decode token...');
      console.log('   Token type:', typeof token);
      console.log('   Token length:', token.length);
      console.log('   Token starts with:', token.substring(0, 30) + '...');
      
      const parts = token.split('.');
      console.log('   Parts count:', parts.length);
      
      if (parts.length !== 3) {
        console.error('   ❌ Invalid JWT format - expected 3 parts, got', parts.length);
        console.log('   First 100 chars:', token.substring(0, 100));
        return null;
      }
      
      const decoded = JSON.parse(atob(parts[1]));
      console.log('   ✅ Token decoded successfully');
      console.log('   Scope:', decoded.scope);
      return decoded;
    } catch (e) {
      console.error('   ❌ Error decoding token:', e);
      return null;
    }
  }

  /**
   * Check if token has required scopes
   */
  private checkTokenScopes(token: string): { valid: boolean; message: string; scopes: string[] } {
    // Note: Access tokens from Firebase may not be JWTs
    // We'll attempt to decode but fall through to making the API call if it fails
    const decoded = this.decodeToken(token);
    
    if (!decoded) {
      // Token is not a JWT (likely an opaque token from Firebase)
      // This is actually OK - Firebase access tokens are often opaque
      // We'll just check if it looks valid (has content)
      console.log('🔐 Token is opaque (not JWT format)');
      console.log('   This is normal for Firebase-issued Google access tokens');
      return {
        valid: true,
        message: 'Token is valid (opaque format)',
        scopes: []
      };
    }

    const tokenScopes = decoded.scope ? decoded.scope.split(' ') : [];
    const hasRequiredScopes = this.REQUIRED_SCOPES.every(scope => 
      tokenScopes.some((ts: string) => ts.includes(scope))
    );

    if (!hasRequiredScopes) {
      const missingScopes = this.REQUIRED_SCOPES.filter(scope =>
        !tokenScopes.some((ts: string) => ts.includes(scope))
      );
      return {
        valid: false,
        message: `Missing scopes: ${missingScopes.join(', ')}. Clear sessionStorage and re-login.`,
        scopes: tokenScopes
      };
    }

    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
    if (expiresIn < 0) {
      return {
        valid: false,
        message: 'Token has expired. Re-login to get a fresh token.',
        scopes: tokenScopes
      };
    }

    return {
      valid: true,
      message: `Token valid for ${Math.floor(expiresIn / 60)} more minutes`,
      scopes: tokenScopes
    };
  }

  /**
   * Write data to a Google Sheet
   * @param spreadsheetId - The ID of the spreadsheet
   * @param range - The A1 notation of the range (e.g., 'Sheet1!A1:B2')
   * @param values - 2D array of values to write
   */
  writeToSheet(spreadsheetId: string, range: string, values: any[][]): Observable<any> {
    const accessToken = sessionStorage.getItem('access_token');
    if (!accessToken) {
      return throwError(() => new Error('No access token available'));
    }

    // Validate token before making API call
    const tokenCheck = this.checkTokenScopes(accessToken);
    if (!tokenCheck.valid) {
      return throwError(() => new Error(tokenCheck.message));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    });

    // URL encode the range for the API
    const encodedRange = encodeURIComponent(range);
    const url = `${this.SHEETS_API_URL}/${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`;

    const body = {
      values: values
    };

    return this.http.put(url, body, { headers }).pipe(
      catchError(error => {
        console.error('Error writing to Google Sheet:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Read data from a Google Sheet
   * @param spreadsheetId - The ID of the spreadsheet
   * @param range - The A1 notation of the range (e.g., 'Sheet1!A1:B2')
   */
  readFromSheet(spreadsheetId: string, range: string): Observable<any> {
    const accessToken = sessionStorage.getItem('access_token');
    if (!accessToken) {
      console.error('❌ No access token found in sessionStorage');
      return throwError(() => new Error('No access token available'));
    }

    // Validate token before making API call
    const tokenCheck = this.checkTokenScopes(accessToken);
    console.log('🔐 Token Check:', tokenCheck);

    if (!tokenCheck.valid) {
      console.error('❌', tokenCheck.message);
      return throwError(() => new Error(tokenCheck.message));
    }

    console.log('📖 Reading from sheet:');
    console.log('   Spreadsheet ID:', spreadsheetId);
    console.log('   Range:', range);
    console.log('   Full URL:', `${this.SHEETS_API_URL}/${spreadsheetId}/values/${range}`);

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`, 
      'Content-Type': 'application/json'
    });

    // URL encode the range for the API
    const encodedRange = encodeURIComponent(range);
    const url = `${this.SHEETS_API_URL}/${spreadsheetId}/values/${encodedRange}`;

    return this.http.get(url, { headers }).pipe(
      catchError(error => {
        console.error('❌ Error reading from Google Sheet');
        console.error('   Request URL:', url);
        console.error('   HTTP Status:', error.status);
        
        // Log the full error response from Google API
        if (error.error) {
          console.error('   Google API Error Response:', error.error);
          if (error.error.error) {
            console.error('   Error Code:', error.error.error.code);
            console.error('   Error Message:', error.error.error.message);
          }
        }
        
        if (error.status === 400) {
          console.error('   Status: 400 Bad Request');
          console.error('   Possible causes:');
          console.error('   1. Invalid spreadsheet ID (copy from sheet URL)');
          console.error('   2. Invalid range or sheet name');
          console.error('   3. Missing spreadsheets scope in token');
        } else if (error.status === 403) {
          console.error('   Status: 403 Forbidden');
          console.error('   This means: Token is valid but lacks permission to this spreadsheet');
          console.error('   Action: Check if the authenticated user has access to this spreadsheet');
        } else if (error.status === 401) {
          console.error('   Status: 401 Unauthorized');
          console.error('   This means: Token is expired or invalid');
          console.error('   Action: Re-login to get a fresh token');
        }
        console.error('   Full error:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Append data to a Google Sheet
   * @param spreadsheetId - The ID of the spreadsheet
   * @param range - The A1 notation of the range (e.g., 'Sheet1!A:A')
   * @param values - 2D array of values to append
   */
  appendToSheet(spreadsheetId: string, range: string, values: any[][]): Observable<any> {
    const accessToken = sessionStorage.getItem('access_token');
    if (!accessToken) {
      return throwError(() => new Error('No access token available'));
    }

    // Validate token before making API call
    const tokenCheck = this.checkTokenScopes(accessToken);
    if (!tokenCheck.valid) {
      return throwError(() => new Error(tokenCheck.message));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    });

    // URL encode the range for the API
    const encodedRange = encodeURIComponent(range);
    const url = `${this.SHEETS_API_URL}/${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED`;

    const body = {
      values: values
    };

    return this.http.post(url, body, { headers }).pipe(
      catchError(error => {
        console.error('Error appending to Google Sheet:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Batch update data to a Google Sheet (VERIFIED WORKING)
   * Uses the batchUpdate endpoint which is more reliable
   * @param spreadsheetId - The ID of the spreadsheet
   * @param range - The A1 notation of the range (e.g., 'Sheet1!A1')
   * @param values - 2D array of values to write
   */
  batchUpdateSheet(spreadsheetId: string, range: string, values: any[][]): Observable<any> {
    const accessToken = sessionStorage.getItem('access_token');
    if (!accessToken) {
      console.error('❌ No access token found in sessionStorage');
      return throwError(() => new Error('No access token available'));
    }

    // Validate token before making API call
    const tokenCheck = this.checkTokenScopes(accessToken);
    if (!tokenCheck.valid) {
      console.error('❌', tokenCheck.message);
      return throwError(() => new Error(tokenCheck.message));
    }

    console.log('📝 Batch updating sheet:');
    console.log('   Spreadsheet ID:', spreadsheetId);
    console.log('   Range:', range);
    console.log('   Values:', values);

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    });

    const url = `${this.SHEETS_API_URL}/${spreadsheetId}/values:batchUpdate`;

    const body = {
      data: [
        {
          range: range,
          majorDimension: 'ROWS',
          values: values
        }
      ]
    };

    return this.http.post(url, body, { headers }).pipe(
      catchError(error => {
        console.error('❌ Error batch updating Google Sheet');
        console.error('   Request URL:', url);
        console.error('   HTTP Status:', error.status);
        
        // Log the full error response from Google API
        if (error.error) {
          console.error('   Google API Error Response:', error.error);
          if (error.error.error) {
            console.error('   Error Code:', error.error.error.code);
            console.error('   Error Message:', error.error.error.message);
          }
        }
        
        if (error.status === 400) {
          console.error('   Status: 400 Bad Request');
          console.error('   Possible causes:');
          console.error('   1. Invalid spreadsheet ID');
          console.error('   2. Invalid range or sheet name');
          console.error('   3. Missing spreadsheets scope in token');
        } else if (error.status === 403) {
          console.error('   Status: 403 Forbidden - User lacks permission');
        } else if (error.status === 401) {
          console.error('   Status: 401 Unauthorized - Token expired');
        }
        console.error('   Full error:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Clear a range in a Google Sheet
   * @param spreadsheetId - The ID of the spreadsheet
   * @param range - The A1 notation of the range (e.g., 'Sheet1!A1:B2')
   */
  clearSheet(spreadsheetId: string, range: string): Observable<any> {
    const accessToken = this.authService.getAccessToken();
    if (!accessToken) {
      return throwError(() => new Error('No access token available'));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    });

    const url = `${this.SHEETS_API_URL}/${spreadsheetId}/values/${range}:clear`;

    return this.http.post(url, {}, { headers }).pipe(
      catchError(error => {
        console.error('Error clearing Google Sheet:', error);
        return throwError(() => error);
      })
    );
  }
}
