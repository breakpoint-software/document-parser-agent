/**
 * Tenant Model
 * Represents a workspace/organization in the system
 */
export interface Tenant {
  tenant_id: string;
  name: string;
  email?: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  refresh_token?: string;
  refresh_token_updated_at?: Date;
}

/**
 * Tenant Create Request
 * Data required to create a new tenant
 */
export interface TenantCreateRequest {
  name: string;
}

/**
 * Tenant Response
 * API response containing tenant data
 */
export interface TenantResponse extends Tenant {
  id?: string; // Alternative ID field
}
