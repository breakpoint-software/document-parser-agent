import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

// Rule model interface (matching the database structure)
interface Rule {
  rule_id: string;
  rule_name: string;
  source_folder_id: string;
  target_folder_id: string;
  target_sheet_id: string;
  sheet_tab_name: string;
  is_enabled: boolean;
  created_at?: Date;
  updated_at?: Date;
}

@Component({
  selector: 'app-rules-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rules-management.component.html',
  styleUrls: ['./rules-management.component.css']
})
export class RulesManagementComponent implements OnInit, OnDestroy {
  rules: Rule[] = [];
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  showAddForm = false;

  newRule: Partial<Rule> = {
    rule_name: '',
    source_folder_id: '',
    target_folder_id: '',
    target_sheet_id: '',
    sheet_tab_name: '',
    is_enabled: true
  };

  private destroy$ = new Subject<void>();
  private tenantId: string = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId') || '';

    if (!this.tenantId) {
      this.errorMessage = 'Invalid tenant ID';
      return;
    }

    this.loadRules();
  }

  /**
   * Load rules for tenant
   */
  loadRules(): void {
    this.isLoading = true;
    this.errorMessage = '';

    // TODO: Implement loading rules from backend
    // For now, show empty list
    this.rules = [];
    this.isLoading = false;
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

    const rule: Rule = {
      rule_id: `rule_${Date.now()}`,
      rule_name: this.newRule.rule_name || '',
      source_folder_id: this.newRule.source_folder_id || '',
      target_folder_id: this.newRule.target_folder_id || '',
      target_sheet_id: this.newRule.target_sheet_id || '',
      sheet_tab_name: this.newRule.sheet_tab_name || '',
      is_enabled: this.newRule.is_enabled || true
    };

    // TODO: Call backend to create rule
    this.rules.push(rule);
    this.isLoading = false;
    this.successMessage = 'Rule added successfully!';
    this.showAddForm = false;
    this.resetForm();

    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }

  /**
   * Update rule
   */
  updateRule(rule: Rule): void {
    this.isLoading = true;
    this.errorMessage = '';

    // TODO: Call backend to update rule
    this.isLoading = false;
    this.successMessage = 'Rule updated successfully!';

    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }

  /**
   * Delete rule
   */
  deleteRule(ruleId: string): void {
    if (!confirm('Are you sure you want to delete this rule?')) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    // TODO: Call backend to delete rule
    this.rules = this.rules.filter(r => r.rule_id !== ruleId);
    this.isLoading = false;
    this.successMessage = 'Rule deleted successfully!';

    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }

  /**
   * Toggle rule enabled state
   */
  toggleRuleEnabled(rule: Rule): void {
    rule.is_enabled = !rule.is_enabled;
    this.updateRule(rule);
  }

  /**
   * Validate rule form
   */
  private validateRule(): boolean {
    if (!this.newRule.rule_name?.trim()) {
      this.errorMessage = 'Please enter a rule name';
      return false;
    }
    if (!this.newRule.source_folder_id?.trim()) {
      this.errorMessage = 'Please enter source folder ID';
      return false;
    }
    if (!this.newRule.target_folder_id?.trim()) {
      this.errorMessage = 'Please enter target folder ID';
      return false;
    }
    if (!this.newRule.target_sheet_id?.trim()) {
      this.errorMessage = 'Please enter target sheet ID';
      return false;
    }
    if (!this.newRule.sheet_tab_name?.trim()) {
      this.errorMessage = 'Please enter sheet tab name';
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
      target_folder_id: '',
      target_sheet_id: '',
      sheet_tab_name: '',
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
   * Navigate back to dashboard
   */
  goBackToDashboard(): void {
    this.router.navigate(['/dashboard', this.tenantId]);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
