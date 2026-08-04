import { Tenant } from './tenant.model';

/**
 * User Account Model
 * Represents a user account with tenant association
 */
export interface UserAccount {
  id: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  uid: string; // Firebase UID
  tenant_id: string; // Associated tenant ID
  created_at: Date;
  updated_at: Date;
}

/**
 * User Account Create Request
 * Data required to create a new user account
 */
export interface UserAccountCreateRequest {
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  uid: string;
}

/**
 * User Account Response
 * API response containing user and tenant data
 */
export interface UserAccountResponse extends UserAccount {
  tenant?: Tenant;
}
