import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LucideCheck, LucideEllipsisVertical, LucideFolderKanban, LucideLightbulb, LucidePlus, LucideX } from '@lucide/angular';
import { Workspace } from '../../models';
import { ExtractionSchemeService } from '../../services/extraction-scheme';

export interface WorkspaceSelectorDialogData {
  currentWorkspaceId: string;
  workspaces: Workspace[];
}

@Component({
  selector: 'app-workspace-selector-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatTooltipModule, LucideCheck, LucideEllipsisVertical, LucideFolderKanban, LucideLightbulb, LucidePlus, LucideX],
  template: `
    <div mat-dialog-title class="workspace-dialog__header">
      <div>
        <h2 class="workspace-dialog__title">Select a workspace</h2>
        <p class="workspace-dialog__subtitle">Choose a workspace to continue</p>
      </div>
      <div class="workspace-dialog__actions">
        <button mat-flat-button class="workspace-dialog__new" type="button" (click)="dialogRef.close('new')">
          <svg lucidePlus class="mr-2 inline h-4 w-4" aria-hidden="true"></svg>
          New workspace
        </button>
        <button mat-icon-button class="workspace-dialog__close" type="button" aria-label="Close workspace selector" (click)="dialogRef.close()">
          <svg lucideX class="h-5 w-5" aria-hidden="true"></svg>
        </button>
      </div>
    </div>
    <mat-dialog-content>
      <div class="workspace-table" role="table" aria-label="Available workspaces">
        <div class="workspace-table__header" role="row">
          <span>Workspace</span>
          <span>Inbox folder</span>
          <span>Extraction scheme</span>
        </div>
        <div class="workspace-table__body" role="rowgroup">
        <button *ngFor="let workspace of data.workspaces" type="button" class="workspace-table__row" [class.workspace-table__row--current]="workspaceKey(workspace) === data.currentWorkspaceId" role="row" (click)="dialogRef.close(workspace)">
          <span class="workspace-table__name">
            <span class="workspace-table__selected" [class.workspace-table__selected--active]="workspaceKey(workspace) === data.currentWorkspaceId">
              <svg *ngIf="workspaceKey(workspace) === data.currentWorkspaceId" lucideCheck class="h-3.5 w-3.5" aria-label="Current workspace"></svg>
            </span>
            <svg lucideFolderKanban class="workspace-table__workspace-icon" aria-hidden="true"></svg>
            <span class="min-w-0"><span class="block truncate font-semibold">{{ workspace.name }}</span><span *ngIf="workspaceKey(workspace) === data.currentWorkspaceId" class="workspace-table__current">Current workspace</span></span>
          </span>
          <span class="workspace-table__detail truncate" [class.workspace-table__muted]="!workspace.routing?.inbox_folder_name" [matTooltip]="workspace.routing?.inbox_folder_name || 'Not configured'">{{ workspace.routing?.inbox_folder_name || 'Not configured' }}</span>
          <span class="workspace-table__detail workspace-table__scheme" [class.workspace-table__muted]="!workspace.routing?.schema_id" [matTooltip]="schemeName(workspace.routing?.schema_id)">{{ schemeName(workspace.routing?.schema_id) }}</span>
          <span class="workspace-table__action" aria-hidden="true"><svg lucideEllipsisVertical class="workspace-table__more"></svg></span>
        </button>
        <p *ngIf="!data.workspaces.length" class="workspace-table__empty">No workspaces available</p>
        </div>
      </div>
    </mat-dialog-content>
    <div mat-dialog-actions class="workspace-dialog__footer"><div class="workspace-dialog__tip"><svg lucideLightbulb class="h-4 w-4" aria-hidden="true"></svg><span><strong>Tip:</strong> You can change workspaces anytime from the selector in the top bar.</span></div></div>
  `,
  styles: `
    :host { display: block; box-sizing: border-box; width: 100%; max-width: 100%; overflow-x: hidden; background: #ffffff; color: #262626; font-family: 'Manrope', sans-serif; }
    .workspace-dialog__header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-width: 0; padding-bottom: 0.75rem; }
    .workspace-dialog__title { margin: 0; color: #262626; font-family: inherit; font-size: 1.25rem; font-weight: 600; line-height: 1.75rem; }
    .workspace-dialog__subtitle { margin: 0.125rem 0 0; color: #525252; font-size: 0.8125rem; line-height: 1.25rem; }
    .workspace-dialog__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 0.5rem; }
    .workspace-dialog__new { --mdc-filled-button-container-color: #087a2e; --mdc-filled-button-label-text-color: #ffffff; --mdc-filled-button-container-shape: 9999px; height: 2.5rem; border-radius: 9999px !important; padding-inline: 1rem; }
    .workspace-dialog__close { width: 2.5rem; height: 2.5rem; color: #525252; }
    mat-dialog-content { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; overflow: hidden !important; padding: 0 !important; }
    .workspace-table { overflow: hidden; border-top: 1px solid #e3e7e4; border-bottom: 1px solid #e3e7e4; }
    .workspace-table__header, .workspace-table__row { display: grid; grid-template-columns: minmax(10rem, 1fr) minmax(9rem, 0.85fr) minmax(11rem, 1.15fr) 2rem; column-gap: 0.75rem; align-items: center; }
    .workspace-table__header { padding: 0.55rem 1.25rem; border-bottom: 1px solid #e3e7e4; color: #68716b; font-family: inherit; font-size: 0.75rem; font-weight: 600; }
    .workspace-table__body { max-height: min(18rem, 42vh); overflow-y: auto; overflow-x: hidden; }
    .workspace-table__row { width: 100%; min-height: 3.25rem; padding: 0 1.25rem; border: 0; border-bottom: 1px solid #edf0ee; background: #ffffff; color: #404040; font-family: inherit; font-size: 0.8125rem; text-align: left; cursor: pointer; }
    .workspace-table__row:last-child { border-bottom: 0; }
    .workspace-table__row--current { background: #fbfdfb; }
    .workspace-table__row:hover { background: #f4f7f4; outline: none; }
    .workspace-table__row:focus-visible { background: #eef6ef; outline: none; box-shadow: inset 0 0 0 2px #087a2e; }
    .workspace-table__name { display: flex; min-width: 0; align-items: center; gap: 0.5rem; }
    .workspace-table__workspace-icon { width: 1rem; height: 1rem; flex: 0 0 auto; color: #6b746e; }
    .workspace-table__selected { display: inline-flex; width: 1rem; height: 1rem; flex: 0 0 auto; align-items: center; justify-content: center; color: transparent; }
    .workspace-table__selected--active { color: #087a2e; }
    .workspace-table__current { display: inline-flex; margin-top: 0.05rem; border-radius: 999px; background: #e8f5ec; padding: 0.05rem 0.3rem; color: #386747; font-size: 0.6rem; font-weight: 600; line-height: 0.9rem; }
    .workspace-table__detail { min-width: 0; color: #4d5750; }
    .workspace-table__scheme { overflow-wrap: anywhere; white-space: normal; line-height: 1.1rem; }
    .workspace-table__muted { color: #8a938d; }
    .workspace-table__action { display: inline-flex; width: 2rem; height: 2rem; align-items: center; justify-content: center; justify-self: end; border-radius: 999px; color: #68716b; }
    .workspace-table__row:hover .workspace-table__action, .workspace-table__row:focus-visible .workspace-table__action { background: #e9eeea; color: #26312a; }
    .workspace-table__more { width: 1rem; height: 1rem; }
    .workspace-table__empty { margin: 0; padding: 1.25rem; color: #737c76; font-family: inherit; text-align: center; }
    .workspace-dialog__footer { display: block; min-height: 0; margin: 0; padding: 0.75rem 1.5rem 1.25rem; }
    .workspace-dialog__tip { display: flex; gap: 0.5rem; align-items: flex-start; padding: 0.625rem 0.75rem; border-radius: 0.5rem; background: #fafbfa; color: #5c665f; font-size: 0.75rem; line-height: 1.15rem; }
    .workspace-dialog__tip svg { flex: 0 0 auto; color: #087a2e; }
    :host-context(.dark) { background: #212121; color: #ececec; }
    :host-context(.dark) .workspace-dialog__title { color: #ececec; }
    :host-context(.dark) .workspace-dialog__subtitle { color: #a3a3a3; }
    :host-context(.dark) .workspace-table { border-color: #404040; }
    :host-context(.dark) .workspace-table__header { border-color: #404040; color: #d4d4d4; }
    :host-context(.dark) .workspace-table__row { border-color: #303030; background: #262626; color: #ececec; }
    :host-context(.dark) .workspace-table__row--current { background: #283129; }
    :host-context(.dark) .workspace-table__row:hover, :host-context(.dark) .workspace-table__row:focus-visible { background: #2f3d2c; }
    :host-context(.dark) .workspace-table__empty { color: #a3a3a3; }
    :host-context(.dark) .workspace-table__current { background: #183c2b; color: #bbf7d0; }
    :host-context(.dark) .workspace-dialog__tip { background: #2a2f2a; color: #d4d4d4; }
    :host-context(.dark) .workspace-table__more { color: #a3a3a3; }
    @media (max-width: 639px) { mat-dialog-content { min-width: calc(100vw - 2rem); } .workspace-table__header, .workspace-table__row { grid-template-columns: minmax(0, 1fr) 2rem; } .workspace-table__header span:nth-child(2), .workspace-table__header span:nth-child(3), .workspace-table__row > span:nth-child(2), .workspace-table__row > span:nth-child(3) { display: none; } .workspace-dialog__header { align-items: flex-start; } .workspace-dialog__footer { padding-inline: 1rem; } }
  `
})
export class WorkspaceSelectorDialogComponent implements OnInit {
  readonly data = inject<WorkspaceSelectorDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<WorkspaceSelectorDialogComponent, Workspace | 'new'>);
  private readonly extractionSchemeService = inject(ExtractionSchemeService);
  private readonly schemeNames = new Map<string, string>();

  ngOnInit(): void {
    this.extractionSchemeService.listSchemes().subscribe({
      next: schemes => schemes.forEach(scheme => this.schemeNames.set(scheme.schema_id, scheme.name)),
      error: () => undefined
    });
  }

  workspaceKey(workspace: Workspace): string {
    return workspace.id || workspace.workspace_id;
  }

  schemeName(schemaId: string | undefined): string {
    if (!schemaId) return 'Not configured';
    return this.schemeNames.get(schemaId) || schemaId;
  }
}
