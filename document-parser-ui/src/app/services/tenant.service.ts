import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Tenant, TenantCreateRequest, TenantResponse } from '../models';
import { BACKEND_API_CONFIG } from '../config/firebase.config';

@Injectable({
  providedIn: 'root'
})
export class TenantService {
  private apiUrl = `${BACKEND_API_CONFIG.baseUrl}/tenants`;

  constructor(private http: HttpClient) {}

  /**
   * Create a new tenant
   */
  createTenant(tenantData: TenantCreateRequest): Observable<TenantResponse> {
    return this.http.post<TenantResponse>(`${this.apiUrl}`, tenantData);
  }

  /**
   * Get tenant by ID
   */
  getTenant(tenantId: string): Observable<TenantResponse> {
    return this.http.get<TenantResponse>(`${this.apiUrl}/${tenantId}`);
  }

  /**
   * Update tenant
   */
  updateTenant(tenantId: string, tenantData: Partial<Tenant>): Observable<TenantResponse> {
    return this.http.put<TenantResponse>(`${this.apiUrl}/${tenantId}`, tenantData);
  }

  /**
   * Get all tenants for current user
   */
  getUserTenants(): Observable<TenantResponse[]> {
    return this.http.get<TenantResponse[]>(`${this.apiUrl}/user/all`);
  }

  /**
   * Delete tenant (only if user owns it)
   */
  deleteTenant(tenantId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${tenantId}`);
  }
}
