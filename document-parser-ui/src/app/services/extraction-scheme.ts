import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { BACKEND_API_CONFIG } from '../config/firebase.config';
import { ExtractionSchemeResponse, ExtractionSchemesResponse, ExtractionSchemeSummary } from '../models';

@Injectable({
  providedIn: 'root',
})
export class ExtractionSchemeService {
  constructor(private readonly http: HttpClient) {}

  listSchemes(): Observable<Array<Pick<ExtractionSchemeSummary, 'schema_id' | 'name' | 'version'>>> {
    return this.http.get<ExtractionSchemesResponse>(
      `${BACKEND_API_CONFIG.baseUrl}/extraction-schemes`
    ).pipe(map(response => response.schemes));
  }

  getScheme(schemaId: string): Observable<ExtractionSchemeSummary> {
    return this.http.get<ExtractionSchemeResponse>(
      `${BACKEND_API_CONFIG.baseUrl}/extraction-schemes/${encodeURIComponent(schemaId)}`
    ).pipe(map(response => response.scheme));
  }
}
