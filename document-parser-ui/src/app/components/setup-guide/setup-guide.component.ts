import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GOOGLE_CONFIG } from '../../config/google.config';

@Component({
  selector: 'app-setup-guide',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './setup-guide.component.html',
  styleUrls: ['./setup-guide.component.css']
})
export class SetupGuideComponent {
  clientId = GOOGLE_CONFIG.GOOGLE_CLIENT_ID;
  apiKey = GOOGLE_CONFIG.GOOGLE_PICKER_API_KEY;
  serviceAccountEmail = GOOGLE_CONFIG.SERVICE_ACCOUNT_EMAIL;
  redirectUri = GOOGLE_CONFIG.REDIRECT_URI;

  isClientIdMissing = this.clientId.includes('YOUR_');
  isApiKeyMissing = this.apiKey.includes('YOUR_');
  isServiceAccountMissing = this.serviceAccountEmail.includes('YOUR_');
}
