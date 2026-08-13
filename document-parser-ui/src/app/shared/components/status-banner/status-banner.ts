import { NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LucideCircleAlert, LucideCircleCheck, LucideX } from '@lucide/angular';

export type StatusBannerType = 'loading' | 'error' | 'success';

@Component({
  selector: 'app-status-banner',
  imports: [
    NgClass,
    MatButtonModule,
    MatProgressSpinnerModule,
    LucideCircleAlert,
    LucideCircleCheck,
    LucideX,
  ],
  templateUrl: './status-banner.html',
  styleUrl: './status-banner.scss',
})
export class StatusBanner {
  @Input({ required: true }) message = '';
  @Input({ required: true }) type: StatusBannerType = 'loading';
  @Input() dismissible = true;

  @Output() readonly dismissed = new EventEmitter<void>();
}
