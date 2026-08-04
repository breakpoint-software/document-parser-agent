import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="nav-overlay" [class.active]="isOpenMobile()" (click)="closeMobileNav()"></div>
    
    <button class="mobile-toggle" (click)="toggleNav()" 
            title="Toggle navigation"
            [attr.aria-label]="isOpenMobile() ? 'Close menu' : 'Open menu'">
      <span class="hamburger">
        <span></span>
        <span></span>
        <span></span>
      </span>
    </button>

    <nav class="nav-container" [class.collapsed]="isCollapsed()" [class.mobile-open]="isOpenMobile()">
      <div class="nav-header">
        <button class="toggle-btn" (click)="toggleNav()" 
                title="Toggle navigation" 
                [attr.aria-label]="isCollapsed() ? 'Expand menu' : 'Collapse menu'">
          <span class="hamburger">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
        <span class="logo-text">DocParser</span>
      </div>

      <div class="nav-menu" role="navigation">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" 
           class="nav-item" title="Home" (click)="onNavItemClick()">
          <span class="nav-icon">🏠</span>
          <span class="nav-label">Home</span>
        </a>

        <a [routerLink]="dashboardLink()" routerLinkActive="active" 
           class="nav-item" title="Dashboard" (click)="onNavItemClick()">
          <span class="nav-icon">📊</span>
          <span class="nav-label">Dashboard</span>
        </a>

        <a [routerLink]="rulesLink()" routerLinkActive="active" 
           class="nav-item" title="Rules" (click)="onNavItemClick()">
          <span class="nav-icon">⚙️</span>
          <span class="nav-label">Rules</span>
        </a>

        <a href="#" class="nav-item" title="Documents" (click)="onNavItemClick()">
          <span class="nav-icon">📄</span>
          <span class="nav-label">Documents</span>
        </a>

        <a href="#" class="nav-item" title="Settings" (click)="onNavItemClick()">
          <span class="nav-icon">⚙️</span>
          <span class="nav-label">Settings</span>
        </a>

        <a routerLink="/test-oauth" routerLinkActive="active" 
           class="nav-item" title="OAuth Test" (click)="onNavItemClick()">
          <span class="nav-icon">🧪</span>
          <span class="nav-label">OAuth Test</span>
        </a>
      </div>

      <div class="nav-footer">
        <p class="version">v1.0.0</p>
      </div>
    </nav>
  `,
  styles: [`
    :host {
      --nav-width: 260px;
      --nav-collapsed-width: 80px;
      --nav-transition: 0.3s ease;
      --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .nav-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999;
      opacity: 0;
      transition: opacity var(--nav-transition);
    }

    .nav-overlay.active {
      display: block;
      opacity: 1;
    }

    .mobile-toggle {
      display: none;
    }

    .nav-container {
      width: var(--nav-width);
      height: 100vh;
      background: var(--primary-gradient);
      display: flex;
      flex-direction: column;
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      position: fixed;
      left: 0;
      top: 0;
      z-index: 1000;
      overflow-y: auto;
      overflow-x: hidden;
      transition: width var(--nav-transition);
    }

    .nav-container.collapsed {
      width: var(--nav-collapsed-width);
    }

    .nav-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      min-height: 70px;
      flex-shrink: 0;
    }

    .toggle-btn {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      cursor: pointer;
      padding: 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease;
      color: white;
      min-width: 44px;
      min-height: 44px;
      flex-shrink: 0;
    }

    .toggle-btn:active {
      background: rgba(255, 255, 255, 0.25);
    }

    @media (hover: hover) {
      .toggle-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    }

    .hamburger {
      width: 20px;
      height: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .hamburger span {
      width: 100%;
      height: 2px;
      background: white;
      border-radius: 2px;
      transition: all 0.3s ease;
    }

    .logo-text {
      color: white;
      font-weight: 700;
      font-size: 18px;
      letter-spacing: -0.5px;
      white-space: nowrap;
      flex: 1;
    }

    .nav-container.collapsed .logo-text {
      display: none;
    }

    .nav-menu {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px 8px;
      overflow-y: auto;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      color: rgba(255, 255, 255, 0.7);
      text-decoration: none;
      border-radius: 8px;
      transition: all 0.2s ease;
      border-left: 3px solid transparent;
      cursor: pointer;
      min-height: 48px;
      font-size: 14px;
      user-select: none;
    }

    .nav-item:active {
      background: rgba(255, 255, 255, 0.15);
      color: white;
    }

    @media (hover: hover) {
      .nav-item:hover {
        background: rgba(255, 255, 255, 0.1);
        color: white;
      }
    }

    .nav-item.active {
      background: rgba(255, 255, 255, 0.15);
      color: white;
      border-left-color: #4ade80;
      font-weight: 600;
    }

    .nav-icon {
      font-size: 20px;
      min-width: 24px;
      text-align: center;
      flex-shrink: 0;
    }

    .nav-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .nav-container.collapsed .nav-label {
      display: none;
    }

    .nav-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding: 16px;
      text-align: center;
      flex-shrink: 0;
    }

    .nav-container.collapsed .nav-footer {
      display: none;
    }

    .version {
      color: rgba(255, 255, 255, 0.5);
      font-size: 12px;
      margin: 0;
    }

    .nav-menu::-webkit-scrollbar {
      width: 6px;
    }

    .nav-menu::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
    }

    .nav-menu::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
    }

    .nav-menu::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    /* Tablet & Mobile - up to 1024px */
    @media (max-width: 1024px) {
      .nav-container {
        width: 80px;
        position: fixed;
      }

      .nav-label {
        display: none;
      }

      .logo-text {
        display: none;
      }

      .nav-item {
        justify-content: center;
        padding: 12px 8px;
        border-left: 0;
        border-bottom: 3px solid transparent;
      }

      .nav-item.active {
        border-left: 0;
        border-bottom-color: #4ade80;
      }

      .nav-footer {
        display: none;
      }
    }

    /* Mobile only - up to 640px */
    @media (max-width: 640px) {
      .mobile-toggle {
        display: flex;
        position: fixed;
        top: 12px;
        left: 12px;
        z-index: 1001;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        cursor: pointer;
        padding: 8px;
        border-radius: 6px;
        align-items: center;
        justify-content: center;
        color: white;
        min-width: 44px;
        min-height: 44px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .toggle-btn {
        display: none;
      }

      .nav-header {
        display: none;
      }

      .nav-container {
        width: 280px;
        position: fixed;
        left: 0;
        top: 0;
        transform: translateX(-100%);
        transition: transform var(--nav-transition);
        z-index: 1000;
      }

      .nav-container.mobile-open {
        transform: translateX(0);
        width: 280px;
      }

      .nav-container.mobile-open .nav-label {
        display: inline;
      }

      .nav-container.mobile-open .logo-text {
        display: inline;
      }

      .nav-container.mobile-open .nav-footer {
        display: block;
      }

      .nav-container.mobile-open .nav-item {
        justify-content: flex-start;
        border-left: 3px solid transparent;
        border-bottom: 0;
      }

      .nav-container.mobile-open .nav-item.active {
        border-left-color: #4ade80;
      }
    }
  `]
})
export class NavigationComponent {
  isCollapsed = signal(false);
  isOpenMobile = signal(false);
  private router = inject(Router);
  private currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(event => event.urlAfterRedirects),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );
  private tenantId = computed(() => {
    const routeMatch = this.currentUrl().match(/^\/(?:dashboard|rules)\/([^/?#]+)/);
    return routeMatch ? decodeURIComponent(routeMatch[1]) : null;
  });
  dashboardLink = computed(() => this.tenantLink('dashboard'));
  rulesLink = computed(() => this.tenantLink('rules'));

  private tenantLink(section: 'dashboard' | 'rules'): string[] {
    const tenantId = this.tenantId();
    return tenantId ? ['/', section, tenantId] : ['/signup'];
  }

  toggleNav() {
    this.isCollapsed.update(value => !value);
  }

  closeMobileNav() {
    this.isOpenMobile.set(false);
  }

  onNavItemClick() {
    if (this.isOpenMobile()) {
      this.closeMobileNav();
    }
  }
}
