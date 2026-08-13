export type ProcessingMode = 'per_rule' | 'inbox';
export type RuleSelectionStrategy = 'llm';

export interface WorkspaceRouting {
  mode: ProcessingMode;
  inbox_folder_id: string;
  inbox_folder_name?: string;
  schema_id: string;
  include_subfolders: boolean;
  unmatched_folder_id?: string;
  corrupted_folder_id?: string;
  selection_strategy: RuleSelectionStrategy;
  multiple_match_policy: 'highest_priority';
}

export interface Workspace {
  workspace_id: string;
  id?: string;
  name: string;
  execution_mode?: 'single_source' | 'source_by_rule';
  email?: string;
  active: boolean;
  routing?: WorkspaceRouting;
  created_at?: Date;
  updated_at?: Date;
}

export interface WorkspaceResponse {
  success: boolean;
  workspace: Workspace;
}

export interface WorkspacesResponse {
  success: boolean;
  workspaces: Workspace[];
}
