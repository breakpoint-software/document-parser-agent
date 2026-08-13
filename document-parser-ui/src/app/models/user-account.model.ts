import { Workspace } from './workspace.model';

/**
 * User Account Model
 * Represents a user account with workspace association
 */
export interface UserAccount {
  id: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  uid: string; // Firebase UID
  workspace_id: string; // Associated workspace ID
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
 * API response containing user and workspace data
 */
export interface UserAccountResponse extends UserAccount {
  workspace?: Workspace;
}
