import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TenantService } from '../../services/tenant.service';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { GooglePickerService, PickedItem } from '../../services/google-picker.service';
import { GoogleDriveService } from '../../services/google-drive.service';
import { GoogleAuthService } from '../../services/google-auth.service';
import { RuleService } from '../../services/rule.service';
import { Rule, RuleInput, TenantResponse } from '../../models';

@Component({
  selector: 'app-unified-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './unified-dashboard.component.html',
  styleUrls: ['./unified-dashboard.component.css']
})
export class UnifiedDashboardComponent implements OnInit, OnDestroy {
  // Tenant info
  tenant: TenantResponse | null = null;
  isRulesPage = false;

  // Rules management
  rules: Rule[] = [];
  searchTerm = '';
  statusFilter: 'all' | 'enabled' | 'disabled' = 'all';
  sortOrder: 'newest' | 'oldest' | 'name' = 'newest';
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  showAddForm = false;
  editingRule: Rule | null = null;
  deletingRuleId: string | null = null;

  // Google Picker states
  pickerReady = false;
  pickerSelection: {
    field: 'source' | 'target' | 'sheet';
    mode: 'create' | 'edit';
  } | null = null;

  newRule: Partial<Rule> = {
    rule_name: '',
    source_folder_id: '',
    source_folder_name: '',
    target_folder_id: '',
    target_folder_name: '',
    target_sheet_id: '',
    target_sheet_name: '',
    sheet_tab_name: '',
    parsing_prompt: '',
    is_enabled: true
  };

  private destroy$ = new Subject<void>();
  private tenantId: string = '';

  constructor(
    private tenantService: TenantService,
    private authService: FirebaseAuthService,
    private googleAuthService: GoogleAuthService,
    private googlePickerService: GooglePickerService,
    private googleDriveService: GoogleDriveService,
    private ruleService: RuleService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId') || '';
    this.isRulesPage = this.route.snapshot.routeConfig?.path?.startsWith('rules/') ?? false;

    if (!this.tenantId || this.tenantId === 'tenant') {
      this.errorMessage = 'Invalid tenant ID';
      return;
    }

    this.initializePage();
  }

  private initializePage(): void {
    if (!this.isRulesPage) {
      this.loadTenant();
    }

    // Load rules
    this.loadRules();

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
          const ruleDraft = selection.mode === 'edit' ? this.editingRule : this.newRule;

          this.googleDriveService.getFullPath(item.id)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: fullPath => {
                if (ruleDraft) {
                  this.applyPickedItem(ruleDraft, selection.field, item, fullPath);
                }
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
    rule: Partial<Rule>,
    field: 'source' | 'target' | 'sheet',
    item: PickedItem,
    fullPath: string
  ): void {
    if (field === 'source') {
      rule.source_folder_id = item.id;
      rule.source_folder_name = fullPath;
    } else if (field === 'target') {
      rule.target_folder_id = item.id;
      rule.target_folder_name = fullPath;
    } else {
      rule.target_sheet_id = item.id;
      rule.target_sheet_name = fullPath;
    }
  }

  /**
   * Load tenant data
   */
  loadTenant(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.tenantService.getTenant(this.tenantId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.tenant = response;
          this.isLoading = false;
        },
        error: (error) => {
          this.isLoading = false;
          console.error('Error loading tenant:', error);
          this.errorMessage = 'Failed to load tenant. Redirecting...';
          setTimeout(() => {
            this.router.navigate(['/signup']);
          }, 2000);
        }
      });
  }

  /**
   * Load rules for tenant
   */
  loadRules(): void {
    this.isLoading = true;
    this.ruleService.getRules(this.tenantId)
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
    const query = this.searchTerm.trim().toLowerCase();
    const filteredRules = this.rules.filter(rule => {
      const matchesStatus = this.statusFilter === 'all'
        || (this.statusFilter === 'enabled' && rule.is_enabled)
        || (this.statusFilter === 'disabled' && !rule.is_enabled);
      const matchesSearch = !query || [
        rule.rule_name,
        rule.source_folder_id,
        rule.target_folder_id,
        rule.sheet_tab_name
      ].some(value => value.toLowerCase().includes(query));

      return matchesStatus && matchesSearch;
    });

    return filteredRules.sort((firstRule, secondRule) => {
      if (this.sortOrder === 'name') {
        return firstRule.rule_name.localeCompare(secondRule.rule_name);
      }

      const firstUpdated = firstRule.updated_at?.getTime() ?? 0;
      const secondUpdated = secondRule.updated_at?.getTime() ?? 0;
      return this.sortOrder === 'newest'
        ? secondUpdated - firstUpdated
        : firstUpdated - secondUpdated;
    });
  }

  /**
   * Open Google Picker for folder selection
   */
  openFolderPicker(folderType: 'source' | 'target', mode: 'create' | 'edit' = 'create'): void {
    console.log('🎯 Opening folder picker for:', folderType);
    console.log('   Picker ready:', this.pickerReady);
    console.log('   Access token:', sessionStorage.getItem('access_token') ? 'Present' : 'Missing');

    if (!this.pickerReady) {
      this.errorMessage = 'Google Picker is not ready yet. Please wait a moment and try again.';
      console.error('❌ Picker not ready. Status:', this.pickerReady);
      return;
    }

    this.pickerSelection = { field: folderType, mode };
    console.log('✅ Calling openFolderPicker on service');
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
   * Copy tenant ID to clipboard
   */
  copyTenantId(): void {
    if (this.tenant?.id) {
      navigator.clipboard.writeText(this.tenant.id).then(() => {
        this.successMessage = 'Tenant ID copied to clipboard!';
        setTimeout(() => {
          this.successMessage = '';
        }, 3000);
      });
    }
  }

  /**
   * Add new rule
   */
  addRule(): void {
    if (!this.validateRule()) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    const rule: RuleInput = {
      rule_name: this.newRule.rule_name || '',
      source_folder_id: this.newRule.source_folder_id || '',
      source_folder_name: this.newRule.source_folder_name || '',
      target_folder_id: this.newRule.target_folder_id || '',
      target_folder_name: this.newRule.target_folder_name || '',
      target_sheet_id: this.newRule.target_sheet_id || '',
      target_sheet_name: this.newRule.target_sheet_name || '',
      sheet_tab_name: this.newRule.sheet_tab_name || '',
      parsing_prompt: this.newRule.parsing_prompt || '',
      is_enabled: this.newRule.is_enabled ?? true
    };

    this.ruleService.createRule(this.tenantId, rule)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: createdRule => {
          this.rules = [createdRule, ...this.rules];
          this.isLoading = false;
          this.successMessage = 'Rule added successfully!';
          this.showAddForm = false;
          this.resetForm();
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

    this.ruleService.updateRule(this.tenantId, rule.rule_id, rule)
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
    this.editingRule = { ...rule };
  }

  saveEditedRule(): void {
    if (!this.editingRule || !this.validateRule(this.editingRule)) {
      return;
    }

    const ruleIndex = this.rules.findIndex(rule => rule.rule_id === this.editingRule?.rule_id);
    if (ruleIndex === -1) {
      this.errorMessage = 'Rule not found';
      return;
    }

    this.updateRule(this.editingRule);
  }

  cancelEditingRule(): void {
    this.editingRule = null;
    this.errorMessage = '';
  }

  /**
   * Delete rule
   */
  deleteRule(ruleId: string): void {
    if (!confirm('Are you sure you want to delete this rule?')) {
      return;
    }

    this.isLoading = true;
  this.deletingRuleId = ruleId;
    this.errorMessage = '';

    this.ruleService.deleteRule(this.tenantId, ruleId)
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

  /**
   * Validate rule form
   */
  private validateRule(rule: Partial<Rule> = this.newRule): boolean {
    if (!rule.rule_name?.trim()) {
      this.errorMessage = 'Please enter a rule name';
      return false;
    }
    if (!rule.source_folder_id?.trim()) {
      this.errorMessage = 'Please select a source folder';
      return false;
    }
    if (!rule.target_folder_id?.trim()) {
      this.errorMessage = 'Please select a target folder';
      return false;
    }
    if (!rule.target_sheet_id?.trim()) {
      this.errorMessage = 'Please enter target sheet ID';
      return false;
    }
    if (!rule.sheet_tab_name?.trim()) {
      this.errorMessage = 'Please enter sheet tab name';
      return false;
    }
    if (!rule.parsing_prompt?.trim()) {
      this.errorMessage = 'Please enter parsing prompt';
      return false;
    }
    return true;
  }

  /**
   * Reset form
   */
  private resetForm(): void {
    this.newRule = {
      rule_name: '',
      source_folder_id: '',
      source_folder_name: '',
      target_folder_id: '',
      target_folder_name: '',
      target_sheet_id: '',
      target_sheet_name: '',
      sheet_tab_name: '',
      parsing_prompt: '',
      is_enabled: true
    };
  }

  /**
   * Cancel adding rule
   */
  cancelAddRule(): void {
    this.showAddForm = false;
    this.resetForm();
    this.errorMessage = '';
  }

  /**
   * Navigate to drive explorer
   */
  navigateToDriveExplorer(): void {
    this.router.navigate(['/drive-explorer']);
  }

  /**
   * Logout
   */
  logout(): void {
    this.authService.logout()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.router.navigate(['/signup']);
        },
        error: (error) => {
          this.errorMessage = 'Failed to logout: ' + error.message;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
