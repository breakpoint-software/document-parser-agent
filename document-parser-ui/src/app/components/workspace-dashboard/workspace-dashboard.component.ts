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
import { LucideChevronDown, LucideCircleCheck, LucideFile, LucideFolderOpen, LucidePencil, LucideX } from '@lucide/angular';
import { Subject, Subscription } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { ExtractionSchemeSummary, Workspace } from '../../models';
import { WorkspaceService } from '../../services/workspace';
import { GooglePickerService } from '../../services/google-picker.service';
import { GoogleDriveService } from '../../services/google-drive.service';
import { ExtractionSchemeService } from '../../services/extraction-scheme';
import { RulesManagementComponent } from '../unified-dashboard/unified-dashboard.component';
import { StatusBanner } from '../../shared/components/status-banner/status-banner';
import { MobileUploadChoiceComponent, MobileUploadChoiceData } from './mobile-upload-choice.component';

type UploadStatus = 'uploading' | 'processing' | 'complete' | 'failed' | 'cancelled';

interface InboxUploadItem {
  id: number;
  name: string;
  status: UploadStatus;
  detail: string;
}

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
    LucideChevronDown,
    LucideCircleCheck,
    LucideFile,
    LucideX,
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
  uploadItems: InboxUploadItem[] = [];
  uploadPanelOpen = true;
  extractionSchemes: Array<Pick<ExtractionSchemeSummary, 'schema_id' | 'name' | 'version'>> = [];
  readonly routingForm;

  private readonly destroy$ = new Subject<void>();
  private readonly uploadSubscriptions = new Map<number, Subscription>();
  private nextUploadId = 1;

  get isProcessingUpload(): boolean {
    return this.uploadItems.some(item => item.status === 'uploading' || item.status === 'processing');
  }

  get completedUploadCount(): number {
    return this.uploadItems.filter(item => item.status === 'complete').length;
  }

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
    this.uploadSubscriptions.forEach(subscription => subscription.unsubscribe());
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
    if (!this.workspace?.routing?.inbox_folder_id) {
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

    if (!this.workspace?.routing?.inbox_folder_id) {
      this.errorMessage = 'Configure and save an inbox folder before uploading a file.';
      return;
    }

    const cameraInput = this.inboxCameraInput?.nativeElement;
    const data: MobileUploadChoiceData = {
      select: choice => {
        if (choice === 'camera' && cameraInput) {
          this.selectInboxUpload(cameraInput);
        } else if (choice === 'file') {
          this.selectInboxUpload(uploadInput);
        }
      }
    };

    this.bottomSheet.open<MobileUploadChoiceComponent, MobileUploadChoiceData>(
      MobileUploadChoiceComponent,
      { ariaLabel: 'Choose how to add a document', data }
    );
  }

  processInboxUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length || !this.workspace?.routing?.inbox_folder_id) return;

    this.errorMessage = '';
    this.successMessage = '';
    this.uploadPanelOpen = true;
    files.forEach(file => this.startInboxUpload(file));
  }

  cancelUploads(): void {
    this.uploadItems.forEach(item => {
      if (item.status === 'uploading' || item.status === 'processing') {
        this.uploadSubscriptions.get(item.id)?.unsubscribe();
        this.uploadSubscriptions.delete(item.id);
        item.status = 'cancelled';
        item.detail = 'Cancelled';
      }
    });
  }

  dismissUploadPanel(): void {
    if (this.isProcessingUpload) this.cancelUploads();
    this.uploadItems = [];
  }

  uploadStatusLabel(item: InboxUploadItem): string {
    switch (item.status) {
      case 'uploading': return 'Uploading';
      case 'processing': return 'Processing';
      case 'complete': return 'Processed';
      case 'failed': return 'Failed';
      default: return 'Cancelled';
    }
  }

  private startInboxUpload(file: File): void {
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    const item: InboxUploadItem = {
      id: this.nextUploadId++,
      name: file.name,
      status: 'uploading',
      detail: 'Uploading to inbox'
    };
    this.uploadItems.push(item);

    if (!['.txt', '.pdf', '.docx', '.jpg', '.jpeg', '.png'].includes(extension)) {
      item.status = 'failed';
      item.detail = 'Unsupported file type';
      return;
    }

    const inboxFolderId = this.workspace?.routing?.inbox_folder_id;
    if (!inboxFolderId) return;

    const uploadSubscription = this.driveService.uploadFile(file, inboxFolderId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: uploadedFile => {
          const fileId = typeof uploadedFile?.id === 'string' ? uploadedFile.id : '';
          if (!fileId) {
            item.status = 'failed';
            item.detail = 'Upload did not return a Drive ID';
            this.uploadSubscriptions.delete(item.id);
            return;
          }

          item.status = 'processing';
          item.detail = 'Extracting document data';
          const processingSubscription = this.workspaceService.processInboxUpload(this.workspaceId, fileId)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: response => {
                if (response.result.status === 'Failed') {
                  item.status = 'failed';
                  item.detail = 'Did not match an enabled rule';
                  return;
                }
                item.status = 'complete';
                item.detail = response.result.duplicate
                  ? 'Already processed'
                  : response.result.selected_rule_name ? `Processed by ${response.result.selected_rule_name}` : 'Processing complete';
              },
              error: error => {
                item.status = 'failed';
                item.detail = error.error?.error || 'Unable to process file';
                this.uploadSubscriptions.delete(item.id);
              },
              complete: () => this.uploadSubscriptions.delete(item.id)
            });
          this.uploadSubscriptions.set(item.id, processingSubscription);
        },
        error: error => {
          item.status = 'failed';
          item.detail = error.error?.error || error.message || 'Unable to upload file';
          this.uploadSubscriptions.delete(item.id);
        }
      });
    this.uploadSubscriptions.set(item.id, uploadSubscription);
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
