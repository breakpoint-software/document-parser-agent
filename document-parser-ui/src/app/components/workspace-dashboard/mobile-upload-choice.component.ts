import { Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatListModule } from '@angular/material/list';
import { LucideCamera, LucideFileUp } from '@lucide/angular';

export type MobileUploadChoice = 'file' | 'camera';

export interface MobileUploadChoiceData {
  select: (choice: MobileUploadChoice) => void;
}

@Component({
  selector: 'app-mobile-upload-choice',
  standalone: true,
  imports: [MatListModule, LucideCamera, LucideFileUp],
  template: `
    <div class="px-4 pb-2 pt-4">
      <h2 class="m-0 text-lg font-semibold">Add a document</h2>
      <p class="mb-2 mt-1 text-sm text-neutral-600">Choose how you want to add it.</p>
    </div>
    <mat-nav-list aria-label="Document source">
      <button mat-list-item type="button" (click)="choose('file')">
        <svg matListItemIcon lucideFileUp class="h-5 w-5" aria-hidden="true"></svg>
        <span matListItemTitle>Choose file</span>
        <span matListItemLine>Upload a PDF, document, or image</span>
      </button>
      <button mat-list-item type="button" (click)="choose('camera')">
        <svg matListItemIcon lucideCamera class="h-5 w-5" aria-hidden="true"></svg>
        <span matListItemTitle>Take picture</span>
        <span matListItemLine>Use your device camera</span>
      </button>
    </mat-nav-list>
  `,
})
export class MobileUploadChoiceComponent {
  private readonly sheetRef = inject(MatBottomSheetRef<MobileUploadChoiceComponent>);
  private readonly data = inject<MobileUploadChoiceData>(MAT_BOTTOM_SHEET_DATA);

  choose(choice: MobileUploadChoice): void {
    // Mobile browsers require file inputs to be opened synchronously from the
    // user's tap. Waiting for afterDismissed() loses that user activation.
    this.data.select(choice);
    this.sheetRef.dismiss(choice);
  }
}
