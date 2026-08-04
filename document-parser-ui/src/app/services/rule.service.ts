import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { BACKEND_API_CONFIG } from '../config/firebase.config';
import { Rule, RuleInput, RuleUpdate } from '../models';

interface RulesResponse {
  rules: ApiRule[];
}

interface RuleResponse {
  rule: ApiRule;
}

type ApiRule = Omit<Rule, 'created_at' | 'updated_at'> & {
  created_at?: string;
  updated_at?: string;
};

@Injectable({
  providedIn: 'root'
})
export class RuleService {
  constructor(private http: HttpClient) {}

  getRules(tenantId: string): Observable<Rule[]> {
    return this.http.get<RulesResponse>(this.rulesUrl(tenantId)).pipe(
      map(response => response.rules.map(rule => this.normalizeRule(rule)))
    );
  }

  createRule(tenantId: string, rule: RuleInput): Observable<Rule> {
    return this.http.post<RuleResponse>(this.rulesUrl(tenantId), rule).pipe(
      map(response => this.normalizeRule(response.rule))
    );
  }

  updateRule(tenantId: string, ruleId: string, rule: RuleUpdate): Observable<Rule> {
    return this.http.put<RuleResponse>(`${this.rulesUrl(tenantId)}/${encodeURIComponent(ruleId)}`, rule).pipe(
      map(response => this.normalizeRule(response.rule))
    );
  }

  deleteRule(tenantId: string, ruleId: string): Observable<void> {
    return this.http.delete<void>(`${this.rulesUrl(tenantId)}/${encodeURIComponent(ruleId)}`);
  }

  private rulesUrl(tenantId: string): string {
    return `${BACKEND_API_CONFIG.baseUrl}/tenants/${encodeURIComponent(tenantId)}/rules`;
  }

  private normalizeRule(rule: ApiRule): Rule {
    return {
      ...rule,
      created_at: rule.created_at ? new Date(rule.created_at) : undefined,
      updated_at: rule.updated_at ? new Date(rule.updated_at) : undefined
    };
  }
}
