export interface ExtractionSchemeField {
  key: string;
  label: string;
  types: string[];
  format?: string;
  operators: string[];
  enum: Array<string | number>;
}

export interface ExtractionSchemeSummary {
  schema_id: string;
  name: string;
  version: number;
  fields: ExtractionSchemeField[];
}

export interface ExtractionSchemeResponse {
  success: boolean;
  scheme: ExtractionSchemeSummary;
}

export interface ExtractionSchemesResponse {
  success: boolean;
  schemes: Array<Pick<ExtractionSchemeSummary, 'schema_id' | 'name' | 'version'>>;
}
