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

  getRules(workspaceId: string): Observable<Rule[]> {
    return this.http.get<RulesResponse>(this.rulesUrl(workspaceId)).pipe(
      map(response => response.rules.map(rule => this.normalizeRule(rule)))
    );
  }

  createRule(workspaceId: string, rule: RuleInput): Observable<Rule> {
    return this.http.post<RuleResponse>(this.rulesUrl(workspaceId), rule).pipe(
      map(response => this.normalizeRule(response.rule))
    );
  }

  updateRule(workspaceId: string, ruleId: string, rule: RuleUpdate): Observable<Rule> {
    return this.http.put<RuleResponse>(`${this.rulesUrl(workspaceId)}/${encodeURIComponent(ruleId)}`, rule).pipe(
      map(response => this.normalizeRule(response.rule))
    );
  }

  deleteRule(workspaceId: string, ruleId: string): Observable<void> {
    return this.http.delete<void>(`${this.rulesUrl(workspaceId)}/${encodeURIComponent(ruleId)}`);
  }

  private rulesUrl(workspaceId: string): string {
    return `${BACKEND_API_CONFIG.baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/rules`;
  }

  private normalizeRule(rule: ApiRule): Rule {
    return {
      ...rule,
      created_at: rule.created_at ? new Date(rule.created_at) : undefined,
      updated_at: rule.updated_at ? new Date(rule.updated_at) : undefined
    };
  }
}
