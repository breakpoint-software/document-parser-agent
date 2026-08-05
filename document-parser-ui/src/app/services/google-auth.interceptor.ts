import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { BACKEND_API_CONFIG } from '../config/firebase.config';
import { GoogleAuthService } from './google-auth.service';

export const googleAuthInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(BACKEND_API_CONFIG.baseUrl)) {
    return next(request);
  }

  const accessToken = inject(GoogleAuthService).getAccessToken();
  if (!accessToken) {
    return next(request);
  }

  return next(request.clone({
    setHeaders: { Authorization: `Bearer ${accessToken}` }
  }));
};