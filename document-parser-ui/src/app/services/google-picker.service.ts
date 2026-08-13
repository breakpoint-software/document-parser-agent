import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { take, filter } from 'rxjs/operators';
import { GOOGLE_CONFIG } from '../config/google.config';
import { GoogleDriveSharingService } from './google-drive-sharing.service';

export interface PickedItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  mimeType: string;
}

@Injectable({
  providedIn: 'root'
})
export class GooglePickerService {
  private pickerApiLoaded = false;
  private pickerReady = new BehaviorSubject<boolean>(false);
  pickerReady$ = this.pickerReady.asObservable();
  
  private googlePickerApiKey = GOOGLE_CONFIG.GOOGLE_PICKER_API_KEY;

  private selectedItems = new BehaviorSubject<PickedItem[]>([]);
  selectedItems$ = this.selectedItems.asObservable();

  constructor(private driveSharingService: GoogleDriveSharingService) {
    this.loadPickerApi();
  }

  /**
   * Load Google Picker API using proper gapi.load() mechanism
   */
  private loadPickerApi(): void {
    if (this.pickerApiLoaded) {
      return;
    }

    // Step 1: Load the Google API client library
    const gapiScript = document.createElement('script');
    gapiScript.src = 'https://apis.google.com/js/api.js';
    gapiScript.async = true;
    gapiScript.defer = true;
    gapiScript.type = 'text/javascript';
    
    gapiScript.onload = () => {
      this.initializeGapiAndPicker();
    };
    
    gapiScript.onerror = (error) => {
      console.error('❌ Failed to load Google API client:', error);
    };
    
    document.head.appendChild(gapiScript);
    this.pickerApiLoaded = true;
  }

  /**
   * Initialize gapi and load the picker library
   */
  private initializeGapiAndPicker(): void {
    // Check if gapi is available
    const maxAttempts = 50;
    let attempts = 0;
    
    const checkGapi = setInterval(() => {
      attempts++;
      if ((window as any).gapi && (window as any).gapi.load) {
        clearInterval(checkGapi);
        this.loadPickerLibrary();
      } else if (attempts > maxAttempts) {
        clearInterval(checkGapi);
        console.error('❌ gapi.load not available after timeout');
      }
    }, 100);
  }

  /**
   * Load the picker library using gapi.load()
   */
  private loadPickerLibrary(): void {
    (window as any).gapi.load('picker', {
      callback: () => {
        this.pickerReady.next(true);
      },
      onerror: () => {
        console.error('❌ Failed to load picker library');
        console.error('📌 Possible causes:');
        console.error('   1. API Key invalid or not configured');
        console.error('   2. Google Picker API not enabled in Cloud Console');
        console.error('   3. Origin not authorized for API key');
      }
    });
  }

  /**
   * Open Google Picker for folder selection only
   * Retrieves access token from sessionStorage
   */
  openFolderPicker(): void {
    const accessToken = sessionStorage.getItem('access_token');
    if (!accessToken) {
      console.error('❌ Access token not found in session');
      return;
    }

    // Check if API key is configured
    if (this.googlePickerApiKey.includes('YOUR_')) {
      console.error('❌ Google Picker API Key not configured');
      return;
    }

    // If picker is already ready, open immediately
    if (this.pickerReady.value) {
      this.createAndShowFolderPicker(accessToken);
      return;
    }

    // Wait for picker to be ready
    this.pickerReady$
      .pipe(
        filter(isReady => isReady),
        take(1)
      )
      .subscribe({
        next: () => {
          this.createAndShowFolderPicker(accessToken);
        },
        error: (err) => {
          console.error('❌ Error waiting for picker:', err);
        }
      });
  }

  openSpreadsheetPicker(): void {
    const accessToken = sessionStorage.getItem('access_token');
    if (!accessToken) {
      console.error('Access token not found in session');
      return;
    }

    if (this.googlePickerApiKey.includes('YOUR_')) {
      console.error('Google Picker API Key not configured');
      return;
    }

    if (this.pickerReady.value) {
      this.createAndShowSpreadsheetPicker(accessToken);
      return;
    }

    this.pickerReady$
      .pipe(
        filter(isReady => isReady),
        take(1)
      )
      .subscribe(() => this.createAndShowSpreadsheetPicker(accessToken));
  }

  private createAndShowSpreadsheetPicker(accessToken: string): void {
    try {
      const google = (window as any).google;
      const picker = google.picker;
      const spreadsheetMimeType = 'application/vnd.google-apps.spreadsheet';
      const shortcutMimeType = 'application/vnd.google-apps.shortcut';
      const spreadsheetView = new picker.DocsView(picker.ViewId.DOCS)
        .setLabel('Google Sheets')
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setParent('root')
        .setMimeTypes(`${spreadsheetMimeType},${shortcutMimeType}`);

      const pickerInstance = new picker.PickerBuilder()
        .addView(spreadsheetView)
        .setOAuthToken(accessToken)
        .setDeveloperKey(this.googlePickerApiKey)
        .setSelectableMimeTypes(`${spreadsheetMimeType},${shortcutMimeType}`)
        .enableFeature(picker.Feature.SUPPORT_DRIVES)
        .setCallback((data: any) => this.handleSpreadsheetPickerCallback(data))
        .build();

      pickerInstance.setVisible(true);
    } catch (error) {
      console.error('Error creating spreadsheet picker:', error);
    }
  }

  private handleSpreadsheetPickerCallback(data: any): void {
    const picker = (window as any).google.picker;
    if (data.action !== picker.Action.PICKED || !data.docs?.length) {
      return;
    }

    const doc = data.docs[0];
    const targetId = doc.mimeType === 'application/vnd.google-apps.shortcut'
      ? doc.shortcutDetails?.targetId || doc.id
      : doc.id;
    const item: PickedItem = {
      id: targetId,
      name: doc.name,
      type: 'file',
      mimeType: doc.shortcutDetails?.targetMimeType || doc.mimeType
    };

    this.driveSharingService.shareWithServiceAccount(item.id, item.name, 'writer')
      .subscribe({
        next: () => this.selectedItems.next([item]),
        error: error => {
          console.error('Failed to grant spreadsheet permissions:', error);
          this.selectedItems.next([item]);
        }
      });
  }

  /**
   * Create and display the Google Picker modal for folders only
   */
  private createAndShowFolderPicker(accessToken: string): void {
    try {
      const google = (window as any).google;
      const picker = google.picker;
      const ViewId = google.picker.ViewId;
      const folderMimeType = 'application/vnd.google-apps.folder';
      const shortcutMimeType = 'application/vnd.google-apps.shortcut';

      // Try to use the FOLDERS view if available (Google Picker API)
      // The best approach is to use a custom DocsView filtered to folders only
      const folderView = new picker.DocsView(ViewId.DOCS);
      folderView.setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setSelectFolderEnabled(true)
      .setParent('root');
      folderView.setMimeTypes(`${folderMimeType},${shortcutMimeType}`);
      folderView.setLabel('My Drive');

      const pickerBuilder = new picker.PickerBuilder();

      // Add the folder view
      pickerBuilder.addView(folderView);

      // Set OAuth token
      pickerBuilder.setOAuthToken(accessToken);

      // Set API key
      pickerBuilder.setDeveloperKey(this.googlePickerApiKey);

      // Only allow folders to be selected
      pickerBuilder.setSelectableMimeTypes(`${folderMimeType},${shortcutMimeType}`);

      // Set callback
      pickerBuilder.setCallback((data: any) => {
        this.handleFolderPickerCallback(data);
      });

      // Add support for drives
      pickerBuilder.enableFeature(picker.Feature.SUPPORT_DRIVES);

      const pickerInstance = pickerBuilder.build();
      pickerInstance.setVisible(true);
    } catch (error) {
      console.error('❌ Error creating folder picker:', error);
      console.error('Full error:', error);
    }
  }

  /**
   * Handle folder picker callback
   */
  private handleFolderPickerCallback(data: any): void {
    try {
      const google = (window as any).google;
      const picker = google.picker;

      if (data.action === picker.Action.PICKED) {
        if (data.docs && data.docs.length > 0) {
          const doc = data.docs[0];
          const targetId = doc.mimeType === 'application/vnd.google-apps.shortcut'
            ? doc.shortcutDetails?.targetId || doc.id
            : doc.id;

          const item: PickedItem = {
            id: targetId,
            name: doc.name,
            type: 'folder',
            mimeType: doc.shortcutDetails?.targetMimeType || doc.mimeType
          };

          // Grant write permissions to the selected folder
          this.driveSharingService.shareWithServiceAccount(doc.id, doc.name, 'writer')
            .subscribe({
              next: () => {
                this.selectedItems.next([item]);
              },
              error: (error) => {
                console.error('❌ Failed to grant permissions:', error);
                // Still add the folder even if permission grant fails
                this.selectedItems.next([item]);
              }
            });
        }
      }
    } catch (error) {
      console.error('❌ Error handling picker callback:', error);
    }
  }

  /**
   * Step 2: Open Google Picker modal
   */
  openPicker(accessToken: string): Promise<PickedItem[]> {
    return new Promise((resolve, reject) => {
      if (!accessToken) {
        reject('Access token is required to open Google Picker');
        return;
      }

      // Check if API key is configured
      if (this.googlePickerApiKey.includes('YOUR_')) {
        console.error('❌ Google Picker API Key not configured');
        reject('Google Picker API Key not configured. Please check google.config.ts');
        return;
      }

      // Wait for picker to be ready - take(1) automatically unsubscribes after first emission
      let timedOut = false;
      
      this.pickerReady$
        .pipe(
          filter(isReady => isReady),
          take(1)
        )
        .subscribe({
          next: () => {
            if (!timedOut) {
              this.createAndShowPicker(accessToken, resolve, reject);
            }
          },
          error: (err) => {
            console.error('❌ Error waiting for picker:', err);
            reject('Error waiting for picker to load');
          }
        });
      
      // Timeout if picker doesn't load
      setTimeout(() => {
        if (!this.pickerReady.value) {
          timedOut = true;
          console.error('❌ Timeout: Picker failed to load');
          reject('Google Picker API failed to load. Check console for errors.');
        }
      }, 10000);
    });
  }

  /**
   * Create and display the Google Picker modal with multiple views for exploration
   */
  private createAndShowPicker(
    accessToken: string,
    resolve: (items: PickedItem[]) => void,
    reject: (error: string) => void
  ): void {
    try {
      const google = (window as any).google;
      const picker = google.picker;
      const doc = google.picker.ViewId;

      const pickerBuilder = new picker.PickerBuilder()
        // Main Drive view - browse all your drives
        .addView(new picker.DocsView(doc.DOCS)
          .setLabel('My Drive')
          .setIncludeFolders(true))
        
        // Recent files view - quickly access recently used files
        .addView(new picker.DocsView(doc.RECENT)
          .setLabel('Recent')
          .setIncludeFolders(true))
        
        // Starred files view - access favorited items
        .addView(new picker.DocsView(doc.STARRED)
          .setLabel('Starred')
          .setIncludeFolders(true))
        
        // Shared with me view - access files shared by others
        .addView(new picker.DocsView(doc.SHARED)
          .setLabel('Shared with me')
          .setIncludeFolders(true))
        
        // Set OAuth token and API key
        .setOAuthToken(accessToken)
        .setDeveloperKey(this.googlePickerApiKey)
        
        // Enable search
        .enableFeature(picker.Feature.SUPPORT_DRIVES)
        .enableFeature(picker.Feature.SUPPORT_TEAM_DRIVES)
        
        // Allow multi-select so user can pick multiple files at once
        .setSelectableMimeTypes('*')
        
        // Set callback for when user selects items
        .setCallback((data: any) => this.handlePickerCallback(data, resolve, reject));

      const pickerInstance = pickerBuilder.build();
      pickerInstance.setVisible(true);
    } catch (error) {
      console.error('❌ Error creating picker:', error);
      reject('Failed to create picker: ' + error);
    }
  }

  /**
   * Step 3: Handle picker callback - Return selected field/folderID
   */
  private handlePickerCallback(
    data: any,
    resolve: (items: PickedItem[]) => void,
    reject: (error: string) => void
  ): void {
    const google = (window as any).google;
    const picker = google.picker;

    if (data.action === picker.Action.PICKED) {
      const docs = data.docs;
      const items: PickedItem[] = docs.map((doc: any) => ({
        id: doc.mimeType === 'application/vnd.google-apps.shortcut'
          ? doc.shortcutDetails?.targetId || doc.id
          : doc.id,
        name: doc.name,
        type: doc.type === picker.Type.FOLDER ? 'folder' : 'file',
        mimeType: doc.shortcutDetails?.targetMimeType || doc.mimeType
      }));

      // Grant write permissions to all picked items
      let permissionsGranted = 0;
      items.forEach((item) => {
        this.driveSharingService.shareWithServiceAccount(item.id, item.name, 'writer')
          .subscribe({
            next: () => {
              permissionsGranted++;
              // When all permissions are granted, update selectedItems and resolve
              if (permissionsGranted === items.length) {
                this.selectedItems.next(items);
                resolve(items);
              }
            },
            error: (error) => {
              console.error(`⚠️ Failed to grant permissions to "${item.name}":`, error);
              permissionsGranted++;
              // Continue even if one fails
              if (permissionsGranted === items.length) {
                this.selectedItems.next(items);
                resolve(items);
              }
            }
          });
      });

      // If no items, resolve immediately
      if (items.length === 0) {
        this.selectedItems.next([]);
        resolve([]);
      }
    } else if (data.action === picker.Action.CANCEL) {
      reject('Picker was cancelled');
    }
  }

  /**
   * Get the last selected items
   */
  getSelectedItems(): PickedItem[] {
    return this.selectedItems.value;
  }
}
