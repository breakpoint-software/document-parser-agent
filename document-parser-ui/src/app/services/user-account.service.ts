import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { UserAccount, UserAccountCreateRequest, UserAccountResponse } from '../models';
import { BACKEND_API_CONFIG } from '../config/firebase.config';

interface UserAccountApiResponse {
  userAccount: UserAccount;
  tenant?: UserAccountResponse['tenant'];
}

interface UserAccountsApiResponse {
  userAccounts: UserAccount[];
}

@Injectable({
  providedIn: 'root'
})
export class UserAccountService {
  private apiUrl = `${BACKEND_API_CONFIG.baseUrl}/user-accounts`;

  constructor(private http: HttpClient) {}

  /**
   * Create a new user account with associated tenant
   */
  createUserAccount(userData: UserAccountCreateRequest): Observable<UserAccountResponse> {
    return this.http.post<UserAccountApiResponse>(this.apiUrl, userData).pipe(
      map(response => ({ ...response.userAccount, tenant: response.tenant }))
    );
  }

  /**
   * Get user account by ID
   */
  getUserAccount(accountId: string): Observable<UserAccountResponse> {
    return this.http.get<UserAccountApiResponse>(`${this.apiUrl}/${accountId}`).pipe(
      map(response => ({ ...response.userAccount, tenant: response.tenant }))
    );
  }

  /**
   * Get user account by Firebase UID
   */
  getUserAccountByUid(uid: string): Observable<UserAccountResponse> {
    return this.http.get<UserAccountApiResponse>(`${this.apiUrl}/uid/${uid}`).pipe(
      map(response => ({ ...response.userAccount, tenant: response.tenant }))
    );
  }

  /**
   * Update user account
   */
  updateUserAccount(accountId: string, userData: Partial<UserAccount>): Observable<UserAccountResponse> {
    return this.http.put<UserAccountApiResponse>(`${this.apiUrl}/${accountId}`, userData).pipe(
      map(response => ({ ...response.userAccount, tenant: response.tenant }))
    );
  }

  /**
   * Get all user accounts for a tenant
   */
  getTenantUsers(tenantId: string): Observable<UserAccountResponse[]> {
    return this.http.get<UserAccountsApiResponse>(`${this.apiUrl}/tenant/${tenantId}`).pipe(
      map(response => response.userAccounts)
    );
  }

  /**
   * Delete user account
   */
  deleteUserAccount(accountId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${accountId}`);
  }
}
