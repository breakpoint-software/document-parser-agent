import { CommonModule } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  LucideFileScan,
  LucideFolderKanban,
  LucideCircleHelp,
  LucideHouse,
  LucideLayoutDashboard,
  LucideLogOut,
  LucideMenu,
  LucideMoon,
  LucideChevronDown,
  LucideSearch,
  LucideUpload,
  LucideSun
} from '@lucide/angular';
import { filter, map, startWith } from 'rxjs';
import { FirebaseAuthService } from './services/firebase-auth.service';
import { Workspace } from './models';
import { WorkspaceService } from './services/workspace';
import { WorkspaceSelectorDialogComponent, WorkspaceSelectorDialogData } from './components/workspace-selector-dialog/workspace-selector-dialog.component';

interface Breadcrumb {
  label: string;
  route?: string[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatDividerModule,
    MatDialogModule,
    MatListModule,
    MatSidenavModule,
    MatTooltipModule,
    MatToolbarModule,
    LucideFileScan,
    LucideFolderKanban,
    LucideCircleHelp,
    LucideHouse,
    LucideLayoutDashboard,
    LucideLogOut,
    LucideMenu,
    LucideMoon,
    LucideChevronDown,
    LucideSearch,
    LucideSun,
    LucideUpload
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  private static readonly workspaceStorageKey = 'doc-parser-workspace-id';
  private readonly authService = inject(FirebaseAuthService);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(event => event.urlAfterRedirects),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  readonly isHandset = toSignal(
    this.breakpointObserver.observe('(max-width: 767px)').pipe(map(result => result.matches)),
    { initialValue: true }
  );
  readonly isAuthenticated = toSignal(this.authService.isAuthenticated$, { initialValue: false });
  readonly isDarkMode = signal(this.getInitialTheme());
  readonly workspaces = signal<Workspace[]>([]);
  private readonly workspaceId = computed(() => {
    const routeMatch = this.currentUrl().match(/^\/(?:dashboard|rules)\/([^/?#]+)/);
    return routeMatch
      ? decodeURIComponent(routeMatch[1])
      : localStorage.getItem(AppComponent.workspaceStorageKey);
  });

  readonly dashboardLink = computed(() => this.workspaceLink('dashboard'));
  readonly currentWorkspace = computed(() =>
    this.workspaces().find(workspace => this.workspaceKey(workspace) === this.workspaceId())?.name || 'Select workspace'
  );
  readonly pageTitle = computed(() => {
    const url = this.currentUrl();
    if (url.startsWith('/rules/')) return 'Rules';
    if (url.startsWith('/dashboard/')) return 'Dashboard';
    if (url.startsWith('/test-oauth')) return 'OAuth Test';
    if (url.startsWith('/auth-callback')) return 'Google Drive';
    return 'Home';
  });
  readonly breadcrumbs = computed<Breadcrumb[]>(() => {
    const url = this.currentUrl();
    const workspaceId = this.workspaceId();

    if (/^\/rules\/[^/]+\/(?:new|[^/]+\/edit)$/.test(url)) {
      return [];
    }

    if (url.startsWith('/rules/')) {
      return [
        { label: 'Home', route: ['/'] },
        { label: 'Dashboard', route: workspaceId ? ['/dashboard', workspaceId] : ['/'] },
        { label: 'Rules' }
      ];
    }
    if (url.startsWith('/dashboard/')) {
      return [{ label: 'Dashboard' }];
    }
    if (url.startsWith('/test-oauth')) {
      return [{ label: 'Home', route: ['/'] }, { label: 'OAuth Test' }];
    }
    if (url.startsWith('/auth-callback')) {
      return [{ label: 'Home', route: ['/'] }, { label: 'Google Drive' }];
    }

    return [{ label: 'Home' }];
  });

  constructor() {
    effect(() => {
      const routeMatch = this.currentUrl().match(/^\/(?:dashboard|rules)\/([^/?#]+)/);
      if (routeMatch) {
        localStorage.setItem(AppComponent.workspaceStorageKey, decodeURIComponent(routeMatch[1]));
      }
    });

    effect(() => {
      if (!this.isAuthenticated()) {
        this.workspaces.set([]);
        return;
      }
      this.loadWorkspaces();
    });

    effect(() => {
      const darkMode = this.isDarkMode();
      document.documentElement.classList.toggle('dark', darkMode);
      document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
      localStorage.setItem('doc-parser-theme', darkMode ? 'dark' : 'light');
    });
  }

  toggleTheme(): void {
    this.isDarkMode.update(value => !value);
  }

  requestInboxUpload(): void {
    window.dispatchEvent(new CustomEvent('docparser:upload-inbox'));
  }

  isWorkspaceDashboard(): boolean {
    return this.currentUrl().startsWith('/dashboard/') && this.workspaceId() !== 'new';
  }

  selectWorkspace(workspace: Workspace): void {
    void this.router.navigate(['/dashboard', this.workspaceKey(workspace)]);
  }

  openWorkspaceSelector(): void {
    this.dialog.open<WorkspaceSelectorDialogComponent, WorkspaceSelectorDialogData, Workspace | 'new'>(WorkspaceSelectorDialogComponent, {
      width: '42rem',
      maxWidth: 'calc(100vw - 2rem)',
      maxHeight: 'calc(100vh - 2rem)',
      panelClass: 'workspace-selector-dialog-panel',
      data: {
        currentWorkspaceId: this.workspaceId() || '',
        workspaces: this.workspaces()
      }
    }).afterClosed().subscribe(workspace => {
      if (workspace === 'new') {
        void this.router.navigate(['/dashboard', 'new']);
      } else if (workspace) {
        this.selectWorkspace(workspace);
      }
    });
  }

  closeMobileDrawer(drawer: MatSidenav): void {
    if (this.isHandset()) {
      void drawer.close();
    }
  }

  logout(drawer: MatSidenav): void {
    this.authService.logout().subscribe({
      next: () => {
        localStorage.removeItem(AppComponent.workspaceStorageKey);
        this.closeMobileDrawer(drawer);
        void this.router.navigate(['/']);
      },
      error: error => console.error('Failed to log out:', error)
    });
  }

  private workspaceLink(section: 'dashboard' | 'rules'): string[] {
    const workspaceId = this.workspaceId();
    return workspaceId ? ['/', section, workspaceId] : ['/'];
  }

  private loadWorkspaces(): void {
    this.workspaceService.getUserWorkspaces().subscribe({
      next: workspaces => this.workspaces.set(workspaces),
      error: () => this.workspaces.set([])
    });
  }

  workspaceKey(workspace: Workspace): string {
    return workspace.id || workspace.workspace_id;
  }

  private getInitialTheme(): boolean {
    const savedTheme = localStorage.getItem('doc-parser-theme');
    if (savedTheme) {
      return savedTheme === 'dark';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
}
