/**
 * Credentials Model
 * Represents stored API credentials for a workspace
 */
export interface Credentials {
  credential_id: string;
  workspace_id: string;
  openai_api_key: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Credentials Create Request
 * Data required to create credentials
 */
export interface CredentialsCreateRequest {
  workspace_id: string;
  openai_api_key: string;
}

/**
 * Credentials Update Request
 * Data for updating credentials
 */
export interface CredentialsUpdateRequest {
  openai_api_key?: string;
}
