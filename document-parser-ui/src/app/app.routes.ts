import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/workspace-entry/workspace-entry').then(module => module.WorkspaceEntry)
  },
  {
    path: 'auth-callback',
    loadComponent: () => import('./components/google-auth/google-auth.component').then(module => module.GoogleAuthComponent)
  },
  {
    path: 'dashboard/:workspaceId',
    loadComponent: () => import('./components/workspace-dashboard/workspace-dashboard.component').then(module => module.WorkspaceDashboardComponent)
  },
  {
    path: 'rules/:workspaceId',
    loadComponent: () => import('./components/unified-dashboard/unified-dashboard.component').then(module => module.RulesManagementComponent)
  },
  {
    path: 'test-oauth',
    loadComponent: () => import('./components/test-oauth/test-oauth.component').then(module => module.TestOAuthComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
