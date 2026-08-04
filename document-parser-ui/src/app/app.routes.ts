import { Routes } from '@angular/router';
import { GoogleAuthComponent } from './components/google-auth/google-auth.component';
import { SignupComponent } from './components/signup/signup.component';
import { UnifiedDashboardComponent } from './components/unified-dashboard/unified-dashboard.component';
import { TestOAuthComponent } from './components/test-oauth/test-oauth.component';

export const routes: Routes = [
  {
    path: '',
    component: SignupComponent
  },
  {
    path: 'signup',
    component: SignupComponent
  },
  {
    path: 'auth-callback',
    component: GoogleAuthComponent
  },
  {
    path: 'dashboard/:tenantId',
    component: UnifiedDashboardComponent
  },
  {
    path: 'rules/:tenantId',
    component: UnifiedDashboardComponent
  },
  {
    path: 'test-oauth',
    component: TestOAuthComponent
  }
];
