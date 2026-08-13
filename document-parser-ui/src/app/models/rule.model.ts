export interface RuleCondition {
	field: string;
	operator: string;
	value: string | number | boolean | Array<string | number> | null;
}

export interface Rule {
	rule_id: string;
	rule_name: string;
	source_folder_id: string;
	source_folder_name?: string;
	target_folder_id: string;
	target_folder_name?: string;
	target_sheet_id: string;
	target_sheet_name?: string;
	sheet_tab_name: string;
	schema_id?: string;
	is_enabled: boolean;
	priority?: number;
	condition_mode?: 'all' | 'any';
	conditions?: RuleCondition[];
	actions?: {
		move_to_folder: boolean;
		append_to_sheet: boolean;
	};
	created_at?: Date;
	updated_at?: Date;
}

export type RuleInput = Omit<Rule, 'rule_id' | 'created_at' | 'updated_at'>;
export type RuleUpdate = Partial<RuleInput>;
