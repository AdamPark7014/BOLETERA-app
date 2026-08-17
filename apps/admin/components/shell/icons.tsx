import type { SVGProps } from 'react';

export type IconName =
  | 'home'
  | 'events'
  | 'calendar'
  | 'series'
  | 'orders'
  | 'mapPin'
  | 'channels'
  | 'campaigns'
  | 'resale'
  | 'analytics'
  | 'reports'
  | 'egress'
  | 'payouts'
  | 'fraud'
  | 'scanner'
  | 'branding'
  | 'payments'
  | 'platform'
  | 'waitlist'
  | 'partners'
  | 'billing'
  | 'season'
  | 'team'
  | 'audit'
  | 'search'
  | 'bell'
  | 'help'
  | 'menu'
  | 'close'
  | 'logout'
  | 'chevronDown'
  | 'chevronRight'
  | 'star'
  | 'starFilled'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'panelLeft'
  | 'panelLeftClose'
  | 'user'
  | 'building'
  | 'keyboard'
  | 'external'
  | 'check'
  | 'dot';

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

const PATHS: Record<IconName, string> = {
  home: 'M3 12 12 3l9 9M5 10v10h14V10',
  events: 'M4 7h16v13H4zM4 7l2-3h12l2 3M9 12h6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  series: 'M4 5h12M4 12h16M4 19h9M18 8v8',
  orders: 'M6 4h12l2 6-7 10-7-10zM3 10h18',
  mapPin:
    'M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  channels: 'M4 12h4l3-7 4 14 3-7h2',
  campaigns: 'M3 11l18-7-7 18-2-7-9-4z',
  resale:
    'M7 7h13l-1.5 9H7zM7 7 6 4H3M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  analytics: 'M3 21V3M3 21h18M7 17v-5M11 17v-9M15 17v-3M19 17v-7',
  reports: 'M6 3h9l5 5v13H6zM14 3v6h6',
  egress: 'M4 12h10M14 12l-3-3M14 12l-3 3M18 5v14',
  payouts: 'M2 8h20v10H2zM6 12h2M14 12h4',
  fraud: 'M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7l8-4zM9 12l2 2 4-4',
  scanner:
    'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18',
  branding:
    'M12 3a9 9 0 1 0 9 9c0-1-3 0-5-2s-1-5-2-6-1-1-2-1zM7 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM16 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM16 16a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM10 17a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  payments: 'M2 7h20v10H2zM6 12h4M14 12h4',
  platform: 'M4 6h16v12H4zM8 10h8M8 14h5M12 2v4M12 18v4',
  waitlist: 'M4 6h16v12H4zM8 10h8M8 14h5M12 2v4',
  partners: 'M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7l8-4zM9 12h6M12 9v6',
  billing:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6M9 11h6',
  season: 'M4 4h16v4H4zM4 10h10v10H4zM16 10h4v10h-4z',
  team: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  audit:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  bell: 'M6 8a6 6 0 1 1 12 0v5l2 3H4l2-3V8zM10 19a2 2 0 1 0 4 0',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1 .4-1 1.2-1 1.7M12 17h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6 6 18',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  star: 'M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9 7.2 18l.9-5.4L4.2 8.7l5.4-.8z',
  starFilled:
    'M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9 7.2 18l.9-5.4L4.2 8.7l5.4-.8z',
  sun: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z',
  monitor: 'M3 5h18v12H3zM8 21h8M12 17v4',
  panelLeft: 'M4 4h16v16H4zM10 4v16',
  panelLeftClose: 'M4 4h16v16H4zM14 4v16M8 9l-2 3 2 3',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  building: 'M4 21h16M6 21V5h8v16M14 9h4v12M9 9h2M9 13h2M9 17h2',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 15h10',
  external: 'M14 4h6v6M10 14 20 4M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  check: 'M5 12l5 5L20 7',
  dot: 'M12 12h.01',
};

export function ShellIcon({ name, size = 18, ...rest }: IconProps) {
  const filled = name === 'starFilled';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        d={PATHS[name]}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="currentColor" className="logo-fill" />
      <path
        d="M9 11h14M9 16h14M9 21h9"
        stroke="var(--shell-logo-ink, #0a0a0a)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="22" cy="21" r="2.5" fill="var(--shell-logo-ink, #0a0a0a)" />
    </svg>
  );
}
