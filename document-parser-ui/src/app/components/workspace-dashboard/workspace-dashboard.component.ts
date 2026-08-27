import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideFolderOpen, LucidePencil } from '@lucide/angular';
import { Subject } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { ExtractionSchemeSummary, Workspace } from '../../models';
import { WorkspaceService } from '../../services/workspace';
import { GooglePickerService } from '../../services/google-picker.service';
import { GoogleDriveService } from '../../services/google-drive.service';
import { ExtractionSchemeService } from '../../services/extraction-scheme';
import { RulesManagementComponent } from '../unified-dashboard/unified-dashboard.component';
import { StatusBanner } from '../../shared/components/status-banner/status-banner';
import { MobileUploadChoice, MobileUploadChoiceComponent } from './mobile-upload-choice.component';

@Component({
  selector: 'app-workspace-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatBottomSheetModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatSelectModule,
    LucideFolderOpen,
    LucidePencil,
    RulesManagementComponent,
    StatusBanner
  ],
  templateUrl: './workspace-dashboard.component.html',
  styleUrl: './workspace-dashboard.component.scss'
})
export class WorkspaceDashboardComponent implements OnInit, OnDestroy {
  @ViewChild('inboxUploadInput') private inboxUploadInput?: ElementRef<HTMLInputElement>;
  @ViewChild('inboxCameraInput') private inboxCameraInput?: ElementRef<HTMLInputElement>;
  workspace: Workspace | null = null;
  workspaceId = '';
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  pickerReady = false;
  isEditing = false;
  isNewWorkspace = false;
  isProcessingUpload = false;
  extractionSchemes: Array<Pick<ExtractionSchemeSummary, 'schema_id' | 'name' | 'version'>> = [];
  readonly routingForm;

  private readonly destroy$ = new Subject<void>();

  constructor(
    formBuilder: FormBuilder,
    private readonly bottomSheet: MatBottomSheet,
    private readonly workspaceService: WorkspaceService,
    private readonly pickerService: GooglePickerService,
    private readonly driveService: GoogleDriveService,
    private readonly extractionSchemeService: ExtractionSchemeService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
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
    this.loadExtractionSchemes();
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.workspaceId = params.get('workspaceId') || '';
      this.isNewWorkspace = this.workspaceId === 'new';
      if (this.isNewWorkspace) {
        this.startNewWorkspace();
        return;
      }
      if (!this.workspaceId) {
        this.workspace = null;
        this.errorMessage = 'Invalid workspace ID';
        return;
      }
      this.cancelEditing();
      this.loadWorkspace(this.workspaceId);
    });
    this.pickerService.pickerReady$.pipe(takeUntil(this.destroy$)).subscribe(ready => this.pickerReady = ready);
    this.pickerService.selectedItems$.pipe(takeUntil(this.destroy$)).subscribe(items => {
      const item = items[0];
      if (!item) return;
      this.driveService.getFullPath(item.id).pipe(takeUntil(this.destroy$)).subscribe(path => {
        this.routingForm.patchValue({ inbox_folder_id: item.id, inbox_folder_name: path });
        this.routingForm.markAsDirty();
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
    this.routingForm.markAsPristine();
  }

  cancelEditing(): void {
    if (this.isNewWorkspace) {
      void this.router.navigate(['/']);
      return;
    }
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
    const workspaceUpdate: Partial<Workspace> = {
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
    };
    const saveRequest = this.isNewWorkspace
      ? this.workspaceService.createWorkspace(value.name.trim()).pipe(
        switchMap(workspace => this.workspaceService.updateWorkspace(workspace.id || workspace.workspace_id, workspaceUpdate))
      )
      : this.workspaceService.updateWorkspace(this.workspaceId, workspaceUpdate);

    saveRequest.pipe(takeUntil(this.destroy$)).subscribe({
      next: workspace => {
        this.workspace = workspace;
        this.workspaceId = workspace.id || workspace.workspace_id;
        this.isNewWorkspace = false;
        this.isEditing = false;
        this.routingForm.disable();
        this.successMessage = 'Workspace routing saved.';
        void this.router.navigate(['/dashboard', this.workspaceId]);
      },
      error: error => this.errorMessage = error.error?.error || 'Failed to save workspace routing.'
    });
  }

  selectInboxUpload(fileInput: HTMLInputElement): void {
    if (this.isProcessingUpload || !this.workspace?.routing?.inbox_folder_id) {
      this.errorMessage = 'Configure and save an inbox folder before uploading a file.';
      return;
    }

    fileInput.value = '';
    fileInput.click();
  }

  @HostListener('window:docparser:upload-inbox')
  openGlobalInboxUpload(): void {
    const uploadInput = this.inboxUploadInput?.nativeElement;
    if (!uploadInput) return;

    if (!window.matchMedia('(max-width: 767px)').matches) {
      this.selectInboxUpload(uploadInput);
      return;
    }

    if (this.isProcessingUpload || !this.workspace?.routing?.inbox_folder_id) {
      this.errorMessage = 'Configure and save an inbox folder before uploading a file.';
      return;
    }

    this.bottomSheet.open<MobileUploadChoiceComponent, never, MobileUploadChoice>(
      MobileUploadChoiceComponent,
      { ariaLabel: 'Choose how to add a document' }
    ).afterDismissed().pipe(takeUntil(this.destroy$)).subscribe(choice => {
      if (choice === 'camera' && this.inboxCameraInput) {
        this.selectInboxUpload(this.inboxCameraInput.nativeElement);
      } else if (choice === 'file') {
        this.selectInboxUpload(uploadInput);
      }
    });
  }

  processInboxUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.workspace?.routing?.inbox_folder_id) return;

    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.txt', '.pdf', '.docx', '.jpg', '.jpeg', '.png'].includes(extension)) {
      this.errorMessage = 'Choose a TXT, PDF, DOCX, JPG, JPEG, or PNG file.';
      return;
    }

    this.isProcessingUpload = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.driveService.uploadFile(file, this.workspace.routing.inbox_folder_id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: uploadedFile => {
          const fileId = typeof uploadedFile?.id === 'string' ? uploadedFile.id : '';
          if (!fileId) {
            this.isProcessingUpload = false;
            this.errorMessage = 'The uploaded file did not return a Drive ID.';
            return;
          }

          this.workspaceService.processInboxUpload(this.workspaceId, fileId)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: response => {
                this.isProcessingUpload = false;
                if (response.result.status === 'Failed') {
                  this.errorMessage = `${file.name} did not match an enabled rule.`;
                  return;
                }
                this.successMessage = response.result.duplicate
                  ? `${file.name} was already processed.`
                  : `${file.name} was processed${response.result.selected_rule_name ? ` by ${response.result.selected_rule_name}` : ''}.`;
              },
              error: error => {
                this.isProcessingUpload = false;
                this.errorMessage = error.error?.error || 'Unable to process the uploaded file.';
              }
            });
        },
        error: error => {
          this.isProcessingUpload = false;
          this.errorMessage = error.error?.error || error.message || 'Unable to upload the selected file to the inbox.';
        }
      });
  }

  extractionSchemeName(schemaId: string | null | undefined): string {
    if (!schemaId) return 'Not configured';
    return this.extractionSchemes.find(scheme => scheme.schema_id === schemaId)?.name || schemaId;
  }

  private loadWorkspace(workspaceId: string): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.workspace = null;
    this.routingForm.reset({
      name: '',
      inbox_folder_id: '',
      inbox_folder_name: '',
      schema_id: this.extractionSchemes[0]?.schema_id || 'arg-invoices',
      include_subfolders: false
    });
    this.workspaceService.getWorkspace(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: workspace => {
          if (workspaceId !== this.workspaceId) return;
          this.workspace = workspace;
          this.routingForm.controls.name.setValue(workspace.name);
          if (workspace.routing) {
            this.routingForm.patchValue(workspace.routing);
          }
          this.isLoading = false;
        },
        error: error => {
          if (workspaceId !== this.workspaceId) return;
          console.error('Error loading workspace:', error);
          this.isLoading = false;
          this.errorMessage = 'Failed to load workspace.';
        }
      });
  }

  private startNewWorkspace(): void {
    this.workspace = null;
    this.isLoading = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.isEditing = true;
    this.routingForm.reset({
      name: '',
      inbox_folder_id: '',
      inbox_folder_name: '',
      schema_id: this.extractionSchemes[0]?.schema_id || 'arg-invoices',
      include_subfolders: false
    });
    this.routingForm.enable();
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
