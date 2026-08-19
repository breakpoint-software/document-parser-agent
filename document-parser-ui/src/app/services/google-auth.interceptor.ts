import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { BACKEND_API_CONFIG } from '../config/firebase.config';
import { FirebaseAuthService } from './firebase-auth.service';
import { from, switchMap } from 'rxjs';

export const googleAuthInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(BACKEND_API_CONFIG.baseUrl)) {
    return next(request);
  }

  const firebaseAuth = inject(FirebaseAuthService);
  const token$ = from(firebaseAuth.getAuthToken());
  
  return token$.pipe(
    switchMap(idToken => {
      if (!idToken) {
        return next(request);
      }
      
      const authRequest = request.clone({
        setHeaders: { Authorization: `Bearer ${idToken}` }
      });
      return next(authRequest);
    })
  );
};