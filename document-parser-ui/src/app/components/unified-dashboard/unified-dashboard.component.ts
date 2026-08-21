import { Component, inject, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import {
  LucideArrowLeft,
  LucideChevronDown,
  LucideChevronsUpDown,
  LucideFileSpreadsheet,
  LucideFolderOpen,
  LucidePencil,
  LucidePlus,
  LucideSave,
  LucideSearch,
  LucideTrash2,
  LucideX
} from '@lucide/angular';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { GooglePickerService, PickedItem } from '../../services/google-picker.service';
import { GoogleDriveService } from '../../services/google-drive.service';
import { RuleService } from '../../services/rule.service';
import { ExtractionSchemeField, Rule, RuleInput } from '../../models';
import { ExtractionSchemeService } from '../../services/extraction-scheme';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { StatusBanner } from '../../shared/components/status-banner/status-banner';

@Component({
  selector: 'app-rules-management',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    LucideArrowLeft,
    LucideChevronDown,
    LucideChevronsUpDown,
    LucideFileSpreadsheet,
    LucideFolderOpen,
    LucidePencil,
    LucidePlus,
    LucideSave,
    LucideSearch,
    LucideTrash2,
    LucideX,
    StatusBanner
  ],
  templateUrl: './unified-dashboard.component.html',
  styleUrl: './unified-dashboard.component.scss'
})
export class RulesManagementComponent implements OnInit, OnChanges, OnDestroy {
  private static readonly ruleConditionFields = new Set([
    'supplier_tax_id',
    'buyer_tax_id',
    'invoice_letter'
  ]);
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialog = inject(MatDialog);

  @Input() workspaceId = '';
  @Input() schemaId = 'arg-invoices';
  @Input() embedded = false;

  // Rules management
  rules: Rule[] = [];
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  showAddForm = false;
  editingRule: Rule | null = null;
  deletingRuleId: string | null = null;
  schemeFields: ExtractionSchemeField[] = [];

  readonly filterForm = this.formBuilder.nonNullable.group({
    searchTerm: '',
    statusFilter: this.formBuilder.nonNullable.control<'all' | 'enabled' | 'disabled'>('all'),
    sortOrder: this.formBuilder.nonNullable.control<'newest' | 'oldest' | 'name'>('newest')
  });
  readonly createRuleForm = this.buildRuleForm();
  readonly editRuleForm = this.buildRuleForm();

  // Google Picker states
  pickerReady = false;
  pickerSelection: {
    field: 'target' | 'sheet';
    mode: 'create' | 'edit';
  } | null = null;

  private destroy$ = new Subject<void>();
  private isInitialized = false;
  constructor(
    private googlePickerService: GooglePickerService,
    private googleDriveService: GoogleDriveService,
    private ruleService: RuleService,
    private extractionSchemeService: ExtractionSchemeService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.workspaceId ||= this.route.snapshot.paramMap.get('workspaceId') || '';

    if (!this.workspaceId) {
      this.errorMessage = 'Invalid workspace ID';
      return;
    }

    this.initializePage();
    this.isInitialized = true;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.isInitialized || !changes['workspaceId'] || changes['workspaceId'].firstChange) {
      return;
    }

    this.showAddForm = false;
    this.editingRule = null;
    this.deletingRuleId = null;
    this.errorMessage = '';
    this.successMessage = '';
    this.resetCreateForm();
    this.loadRules();
    this.loadScheme();
  }

  private initializePage(): void {
    this.loadRules();
    this.loadScheme();

    // Monitor Google Picker readiness
    this.googlePickerService.pickerReady$
      .pipe(takeUntil(this.destroy$))
      .subscribe(ready => {
        this.pickerReady = ready;
      });

    // Monitor selected items from picker
    this.googlePickerService.selectedItems$
      .pipe(takeUntil(this.destroy$))
      .subscribe(items => {
        if (items.length > 0 && this.pickerSelection) {
          const item = items[0];
          const selection = this.pickerSelection;

          this.googleDriveService.getFullPath(item.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: fullPath => {
                this.applyPickedItem(selection.mode, selection.field, item, fullPath);
                this.pickerSelection = null;
              },
              error: error => {
                console.error('Failed to resolve Google Drive path:', error);
                this.errorMessage = 'Unable to resolve the full Drive path. Sign out and sign in again to grant Drive metadata access.';
                this.pickerSelection = null;
              }
            });
        }
      });
  }

  private applyPickedItem(
    mode: 'create' | 'edit',
    field: 'target' | 'sheet',
    item: PickedItem,
    fullPath: string
  ): void {
    const form = mode === 'edit' ? this.editRuleForm : this.createRuleForm;

    if (field === 'target') {
      form.patchValue({ target_folder_id: item.id, target_folder_name: fullPath });
    } else {
      form.patchValue({ target_sheet_id: item.id, target_sheet_name: fullPath });
    }
  }

  /**
  * Load rules for workspace
   */
  loadRules(): void {
    this.isLoading = true;
    this.ruleService.getRules(this.workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: rules => {
          this.rules = rules;
          this.isLoading = false;
        },
        error: error => {
          this.isLoading = false;
          this.errorMessage = error.error?.error || 'Failed to load rules';
        }
      });
  }

  get filteredRules(): Rule[] {
    const { searchTerm, statusFilter, sortOrder } = this.filterForm.getRawValue();
    const query = searchTerm.trim().toLowerCase();
    const filteredRules = this.rules.filter(rule => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'enabled' && rule.is_enabled)
        || (statusFilter === 'disabled' && !rule.is_enabled);
      const matchesSearch = !query || [
        rule.rule_name,
        rule.source_folder_id,
        rule.target_folder_id,
        rule.sheet_tab_name
      ].some(value => value.toLowerCase().includes(query));

      return matchesStatus && matchesSearch;
    });

    return filteredRules.sort((firstRule, secondRule) => {
      if (sortOrder === 'name') {
        return firstRule.rule_name.localeCompare(secondRule.rule_name);
      }

      const firstUpdated = firstRule.updated_at?.getTime() ?? 0;
      const secondUpdated = secondRule.updated_at?.getTime() ?? 0;
      return sortOrder === 'newest'
        ? secondUpdated - firstUpdated
        : firstUpdated - secondUpdated;
    });
  }

  /**
   * Open Google Picker for folder selection
   */
  openFolderPicker(folderType: 'target', mode: 'create' | 'edit' = 'create'): void {
    if (!this.pickerReady) {
      this.errorMessage = 'Google Picker is not ready yet. Please wait a moment and try again.';
      return;
    }

    this.pickerSelection = { field: folderType, mode };
    this.googlePickerService.openFolderPicker();
  }

  openSheetPicker(mode: 'create' | 'edit' = 'create'): void {
    if (!this.pickerReady) {
      this.errorMessage = 'Google Picker is not ready yet. Please wait a moment and try again.';
      return;
    }

    this.pickerSelection = { field: 'sheet', mode };
    this.googlePickerService.openSpreadsheetPicker();
  }

  /**
   * Add new rule
   */
  addRule(): void {
    if (this.createRuleForm.invalid) {
      this.createRuleForm.markAllAsTouched();
      this.errorMessage = 'Complete all required rule fields.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const rule: RuleInput = this.toRuleInput(this.createRuleForm.getRawValue());

    this.ruleService.createRule(this.workspaceId, rule)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: createdRule => {
          this.rules = [createdRule, ...this.rules];
          this.isLoading = false;
          this.successMessage = 'Rule added successfully!';
          this.showAddForm = false;
          this.resetCreateForm();
        },
        error: error => {
          this.isLoading = false;
          this.errorMessage = error.error?.error || 'Failed to create rule';
        }
      });
  }

  /**
   * Update rule
   */
  updateRule(rule: Rule): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.ruleService.updateRule(this.workspaceId, rule.rule_id, rule)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: updatedRule => {
          this.rules = this.rules.map(currentRule =>
            currentRule.rule_id === updatedRule.rule_id ? updatedRule : currentRule
          );
          this.isLoading = false;
          this.editingRule = null;
          this.successMessage = 'Rule updated successfully!';
        },
        error: error => {
          this.isLoading = false;
          this.errorMessage = error.error?.error || 'Failed to update rule';
        }
      });
  }

  startEditingRule(rule: Rule): void {
    this.showAddForm = false;
    this.errorMessage = '';
    this.editingRule = rule;
    this.editRuleForm.reset({
      rule_name: rule.rule_name,
      target_folder_id: rule.target_folder_id,
      target_folder_name: rule.target_folder_name || '',
      target_sheet_id: rule.target_sheet_id,
      target_sheet_name: rule.target_sheet_name || '',
      sheet_tab_name: rule.sheet_tab_name,
      priority: rule.priority ?? 100,
      condition_mode: rule.condition_mode ?? 'all',
      is_enabled: rule.is_enabled
    });
    this.setConditions(this.editRuleForm.controls.conditions, rule.conditions);
  }

  saveEditedRule(): void {
    if (!this.editingRule) {
      return;
    }
    if (this.editRuleForm.invalid) {
      this.editRuleForm.markAllAsTouched();
      this.errorMessage = 'Complete all required rule fields.';
      return;
    }

    const ruleIndex = this.rules.findIndex(rule => rule.rule_id === this.editingRule?.rule_id);
    if (ruleIndex === -1) {
      this.errorMessage = 'Rule not found';
      return;
    }

    this.updateRule({ ...this.editingRule, ...this.toRuleInput(this.editRuleForm.getRawValue()) });
  }

  cancelEditingRule(): void {
    this.editingRule = null;
    this.editRuleForm.reset();
    this.errorMessage = '';
  }

  /**
   * Delete rule
   */
  deleteRule(ruleId: string): void {
    const ruleName = this.rules.find(rule => rule.rule_id === ruleId)?.rule_name || 'this rule';
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete rule?',
        message: `Delete ${ruleName}? This action cannot be undone.`,
        confirmLabel: 'Delete'
      },
      restoreFocus: true
    }).afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe(confirmed => {
        if (confirmed) {
          this.deleteRuleConfirmed(ruleId);
        }
      });
  }

  private deleteRuleConfirmed(ruleId: string): void {
    this.isLoading = true;
    this.deletingRuleId = ruleId;
    this.errorMessage = '';
    this.successMessage = '';

    this.ruleService.deleteRule(this.workspaceId, ruleId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.rules = this.rules.filter(rule => rule.rule_id !== ruleId);
          this.isLoading = false;
          this.deletingRuleId = null;
          this.successMessage = 'Rule deleted successfully!';
        },
        error: error => {
          this.isLoading = false;
          this.deletingRuleId = null;
          this.errorMessage = error.error?.error || 'Failed to delete rule';
        }
      });
  }

  /**
   * Toggle rule enabled state
   */
  toggleRuleEnabled(rule: Rule): void {
    this.updateRule({ ...rule, is_enabled: !rule.is_enabled });
  }

  private buildRuleForm() {
    return this.formBuilder.nonNullable.group({
      rule_name: ['', [Validators.required, Validators.maxLength(120)]],
      target_folder_id: ['', Validators.required],
      target_folder_name: ['', Validators.required],
      target_sheet_id: [''],
      target_sheet_name: [''],
      sheet_tab_name: ['', Validators.maxLength(100)],
      priority: [100, [Validators.required, Validators.min(0)]],
      condition_mode: this.formBuilder.nonNullable.control<'all' | 'any'>('all'),
      conditions: this.formBuilder.array([this.buildConditionForm()]),
      is_enabled: true
    });
  }

  private buildConditionForm() {
    return this.formBuilder.nonNullable.group({
      field: ['', Validators.required],
      operator: ['', Validators.required],
      value: ['', Validators.required]
    });
  }

  addCondition(mode: 'create' | 'edit'): void {
    this.conditionControls(mode).push(this.buildConditionForm());
  }

  removeCondition(mode: 'create' | 'edit', index: number): void {
    const conditions = this.conditionControls(mode);
    if (conditions.length > 1) conditions.removeAt(index);
  }

  conditionControls(mode: 'create' | 'edit'): FormArray<ReturnType<RulesManagementComponent['buildConditionForm']>> {
    return mode === 'create' ? this.createRuleForm.controls.conditions : this.editRuleForm.controls.conditions;
  }

  operatorsFor(fieldKey: string): string[] {
    return this.schemeFields.find(field => field.key === fieldKey)?.operators ?? [];
  }

  operatorLabel(operator: string): string {
    const label = operator.replaceAll('_', ' ');
    return label ? label[0].toUpperCase() + label.slice(1) : '';
  }

  valueInputType(fieldKey: string): 'date' | 'time' | 'number' | 'text' {
    const field = this.schemeFields.find(candidate => candidate.key === fieldKey);
    const format = field?.format
      || (fieldKey === 'date' || fieldKey.endsWith('_date') ? 'date' : undefined)
      || (fieldKey === 'time' || fieldKey.endsWith('_time') ? 'time' : undefined);

    if (format === 'date' || format === 'time') return format;
    if (field?.types.some(type => type === 'number' || type === 'integer')) return 'number';
    return 'text';
  }

  private setConditions(
    formArray: FormArray<ReturnType<RulesManagementComponent['buildConditionForm']>>,
    conditions: Rule['conditions']
  ): void {
    formArray.clear();
    for (const condition of conditions?.length ? conditions : [{ field: '', operator: '', value: '' }]) {
      const form = this.buildConditionForm();
      form.patchValue({ ...condition, value: String(condition.value ?? '') });
      formArray.push(form);
    }
  }

  private toRuleInput(value: ReturnType<typeof this.createRuleForm.getRawValue>): RuleInput {
    return {
      ...value,
      source_folder_id: '',
      source_folder_name: '',
      schema_id: this.schemaId,
      actions: {
        move_to_folder: Boolean(value.target_folder_id),
        append_to_sheet: Boolean(value.target_sheet_id)
      }
    };
  }

  private loadScheme(): void {
    this.extractionSchemeService.getScheme(this.schemaId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: scheme => {
          this.schemeFields = scheme.fields.filter(field =>
            RulesManagementComponent.ruleConditionFields.has(field.key)
          );
        },
        error: error => this.errorMessage = error.error?.error || 'Failed to load extraction scheme fields.'
      });
  }

  private resetCreateForm(): void {
    this.createRuleForm.reset({
      rule_name: '',
      target_folder_id: '',
      target_folder_name: '',
      target_sheet_id: '',
      target_sheet_name: '',
      sheet_tab_name: '',
      priority: 100,
      condition_mode: 'all',
      is_enabled: true
    });
    this.setConditions(this.createRuleForm.controls.conditions, undefined);
  }

  /**
   * Cancel adding rule
   */
  cancelAddRule(): void {
    this.showAddForm = false;
    this.resetCreateForm();
    this.errorMessage = '';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
