import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideFolderOpen, LucidePencil, LucideSave, LucideX } from '@lucide/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ExtractionSchemeSummary, Workspace } from '../../models';
import { WorkspaceService } from '../../services/workspace';
import { GooglePickerService } from '../../services/google-picker.service';
import { GoogleDriveService } from '../../services/google-drive.service';
import { ExtractionSchemeService } from '../../services/extraction-scheme';
import { RulesManagementComponent } from '../unified-dashboard/unified-dashboard.component';
import { StatusBanner } from '../../shared/components/status-banner/status-banner';

@Component({
  selector: 'app-workspace-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatSelectModule,
    LucideFolderOpen,
    LucidePencil,
    LucideSave,
    LucideX,
    RulesManagementComponent,
    StatusBanner
  ],
  templateUrl: './workspace-dashboard.component.html'
})
export class WorkspaceDashboardComponent implements OnInit, OnDestroy {
  workspace: Workspace | null = null;
  workspaceId = '';
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  pickerReady = false;
  isEditing = false;
  extractionSchemes: Array<Pick<ExtractionSchemeSummary, 'schema_id' | 'name' | 'version'>> = [];
  readonly routingForm;

  private readonly destroy$ = new Subject<void>();

  constructor(
    formBuilder: FormBuilder,
    private readonly workspaceService: WorkspaceService,
    private readonly pickerService: GooglePickerService,
    private readonly driveService: GoogleDriveService,
    private readonly extractionSchemeService: ExtractionSchemeService,
    private readonly route: ActivatedRoute,
  ) {
    this.routingForm = formBuilder.nonNullable.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      inbox_folder_id: ['', Validators.required],
      inbox_folder_name: ['', Validators.required],
      schema_id: ['arg-invoices', Validators.required],
      include_subfolders: false
    });
    this.routingForm.disable();
  }

  ngOnInit(): void {
    this.workspaceId = this.route.snapshot.paramMap.get('workspaceId') || '';
    if (!this.workspaceId) {
      this.errorMessage = 'Invalid workspace ID';
      return;
    }
    this.loadWorkspace();
    this.loadExtractionSchemes();
    this.pickerService.pickerReady$.pipe(takeUntil(this.destroy$)).subscribe(ready => this.pickerReady = ready);
    this.pickerService.selectedItems$.pipe(takeUntil(this.destroy$)).subscribe(items => {
      const item = items[0];
      if (!item) return;
      this.driveService.getFullPath(item.id).pipe(takeUntil(this.destroy$)).subscribe(path => {
        this.routingForm.patchValue({ inbox_folder_id: item.id, inbox_folder_name: path });
      });
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  openInboxPicker(): void {
    if (this.pickerReady) this.pickerService.openFolderPicker();
  }

  editRouting(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.isEditing = true;
    this.routingForm.enable();
  }

  cancelEditing(): void {
    if (!this.workspace) return;
    this.routingForm.patchValue({
      name: this.workspace.name,
      ...(this.workspace.routing || {})
    });
    this.isEditing = false;
    this.routingForm.disable();
  }

  saveRouting(): void {
    if (this.routingForm.invalid) {
      this.routingForm.markAllAsTouched();
      return;
    }
    const value = this.routingForm.getRawValue();
    this.workspaceService.updateWorkspace(this.workspaceId, {
      name: value.name.trim(),
      execution_mode: 'single_source',
      routing: {
        mode: 'inbox',
        inbox_folder_id: value.inbox_folder_id,
        inbox_folder_name: value.inbox_folder_name,
        schema_id: value.schema_id,
        include_subfolders: value.include_subfolders,
        selection_strategy: 'llm',
        multiple_match_policy: 'highest_priority'
      }
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: workspace => {
        this.workspace = workspace;
        this.isEditing = false;
        this.routingForm.disable();
        this.successMessage = 'Workspace routing saved.';
      },
      error: error => this.errorMessage = error.error?.error || 'Failed to save workspace routing.'
    });
  }

  private loadWorkspace(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.workspaceService.getWorkspace(this.workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: workspace => {
          this.workspace = workspace;
          this.routingForm.controls.name.setValue(workspace.name);
          if (workspace.routing) {
            this.routingForm.patchValue(workspace.routing);
          }
          this.isLoading = false;
        },
        error: error => {
          console.error('Error loading workspace:', error);
          this.isLoading = false;
          this.errorMessage = 'Failed to load workspace.';
        }
      });
  }

  private loadExtractionSchemes(): void {
    this.extractionSchemeService.listSchemes()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: schemes => {
          this.extractionSchemes = schemes;
          const selectedSchema = this.routingForm.controls.schema_id.value;
          if (schemes.length && !schemes.some(scheme => scheme.schema_id === selectedSchema)) {
            this.routingForm.controls.schema_id.setValue(schemes[0].schema_id);
          }
        },
        error: error => this.errorMessage = error.error?.error || 'Failed to load extraction schemes.'
      });
  }
}