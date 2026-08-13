import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { BACKEND_API_CONFIG } from '../config/firebase.config';
import { Workspace, WorkspaceResponse, WorkspacesResponse } from '../models';

@Injectable({
  providedIn: 'root',
})
export class WorkspaceService {
  private readonly apiUrl = `${BACKEND_API_CONFIG.baseUrl}/workspaces`;

  constructor(private readonly http: HttpClient) {}

  getWorkspace(workspaceId: string): Observable<Workspace> {
    return this.http.get<WorkspaceResponse>(`${this.apiUrl}/${encodeURIComponent(workspaceId)}`).pipe(
      map(response => this.normalize(response.workspace))
    );
  }

  updateWorkspace(workspaceId: string, workspace: Partial<Workspace>): Observable<Workspace> {
    return this.http.put<WorkspaceResponse>(`${this.apiUrl}/${encodeURIComponent(workspaceId)}`, workspace).pipe(
      map(response => this.normalize(response.workspace))
    );
  }

  getUserWorkspaces(): Observable<Workspace[]> {
    return this.http.get<WorkspacesResponse>(`${this.apiUrl}/user/all`).pipe(
      map(response => response.workspaces.map(workspace => this.normalize(workspace)))
    );
  }

  private normalize(workspace: Workspace): Workspace {
    return {
      ...workspace,
      created_at: workspace.created_at ? new Date(workspace.created_at) : undefined,
      updated_at: workspace.updated_at ? new Date(workspace.updated_at) : undefined
    };
  }
}
