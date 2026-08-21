import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { LucideCheck, LucideFolderKanban, LucidePlus } from '@lucide/angular';
import { Workspace } from '../../models';

export interface WorkspaceSelectorDialogData {
  currentWorkspaceId: string;
  workspaces: Workspace[];
}

@Component({
  selector: 'app-workspace-selector-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, LucideCheck, LucideFolderKanban, LucidePlus],
  template: `
    <div mat-dialog-title class="workspace-dialog__header">
      <h2 class="workspace-dialog__title">Select a workspace</h2>
      <button mat-flat-button type="button" (click)="dialogRef.close('new')">
        <svg lucidePlus class="mr-2 inline h-4 w-4" aria-hidden="true"></svg>
        New workspace
      </button>
    </div>
    <mat-dialog-content>
      <div class="workspace-table" role="table" aria-label="Available workspaces">
        <div class="workspace-table__header" role="row">
          <span>Workspace</span>
          <span>Inbox folder</span>
          <span>Extraction scheme</span>
        </div>
        <button *ngFor="let workspace of data.workspaces" type="button" class="workspace-table__row" role="row" (click)="dialogRef.close(workspace)">
          <span class="workspace-table__name">
            <svg *ngIf="workspaceKey(workspace) === data.currentWorkspaceId" lucideCheck class="h-4 w-4 shrink-0 text-green-800" aria-label="Current workspace"></svg>
            <span *ngIf="workspaceKey(workspace) !== data.currentWorkspaceId" class="h-4 w-4 shrink-0"></span>
            <svg lucideFolderKanban class="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true"></svg>
            <span class="truncate">{{ workspace.name }}</span>
          </span>
          <span class="truncate">{{ workspace.routing?.inbox_folder_name || 'Not configured' }}</span>
          <span class="truncate">{{ workspace.routing?.schema_id || 'Not configured' }}</span>
        </button>
        <p *ngIf="!data.workspaces.length" class="workspace-table__empty">No workspaces available</p>
      </div>
    </mat-dialog-content>
  `,
  styles: `
    :host { display: block; background: #ffffff; color: #262626; font-family: 'Manrope', sans-serif; }
    .workspace-dialog__header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .workspace-dialog__title { margin: 0; color: #262626; font-family: inherit; font-size: 1.25rem; font-weight: 600; line-height: 1.75rem; }
    mat-dialog-content { min-width: min(42rem, calc(100vw - 4rem)); padding: 0 !important; }
    .workspace-table__header, .workspace-table__row { display: grid; grid-template-columns: minmax(14rem, 1.2fr) minmax(12rem, 1fr) minmax(10rem, 0.9fr); column-gap: 1rem; align-items: center; }
    .workspace-table__header { padding: 0.625rem 1.5rem; border-top: 1px solid #e5e5e5; border-bottom: 1px solid #e5e5e5; color: #525252; font-family: inherit; font-size: 0.875rem; font-weight: 600; }
    .workspace-table__row { width: 100%; min-height: 3.25rem; padding: 0 1.5rem; border: 0; border-bottom: 1px solid #f5f5f5; background: transparent; color: #404040; font-family: inherit; font-size: 0.875rem; text-align: left; cursor: pointer; }
    .workspace-table__row:hover, .workspace-table__row:focus-visible { background: #f5faf2; outline: none; }
    .workspace-table__row:focus-visible { box-shadow: inset 0 0 0 2px #15803d; }
    .workspace-table__name { display: flex; min-width: 0; align-items: center; gap: 0.75rem; }
    .workspace-table__empty { margin: 0; padding: 1.5rem; color: #737373; font-family: inherit; }
    :host-context(.dark) { background: #212121; color: #ececec; }
    :host-context(.dark) .workspace-dialog__title { color: #ececec; }
    :host-context(.dark) .workspace-table__header { border-color: #383838; color: #d4d4d4; }
    :host-context(.dark) .workspace-table__row { border-color: #303030; color: #ececec; }
    :host-context(.dark) .workspace-table__row:hover, :host-context(.dark) .workspace-table__row:focus-visible { background: #2f3d2c; }
    :host-context(.dark) .workspace-table__empty { color: #a3a3a3; }
  `
})
export class WorkspaceSelectorDialogComponent {
  readonly data = inject<WorkspaceSelectorDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<WorkspaceSelectorDialogComponent, Workspace | 'new'>);

  workspaceKey(workspace: Workspace): string {
    return workspace.id || workspace.workspace_id;
  }
}