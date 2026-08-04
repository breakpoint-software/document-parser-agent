/**
 * Credentials Model
 * Represents stored API credentials for a tenant
 */
export interface Credentials {
  credential_id: string;
  tenant_id: string;
  openai_api_key: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Credentials Create Request
 * Data required to create credentials
 */
export interface CredentialsCreateRequest {
  tenant_id: string;
  openai_api_key: string;
}

/**
 * Credentials Update Request
 * Data for updating credentials
 */
export interface CredentialsUpdateRequest {
  openai_api_key?: string;
}
