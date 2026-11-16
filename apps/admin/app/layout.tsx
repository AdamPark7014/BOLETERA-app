import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import { Providers } from './providers';
import '@boletera/ui/src/styles/theme.scss';
import './globals.scss';
import { blackTicketFontVars } from './fonts';

export const metadata: Metadata = {
  title: 'Black Ticket · Admin',
  description: 'Backoffice de boletería',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#000000',
};

/**
 * Inline boot: sets data-theme on <html> before paint to avoid FOUC.
 * Key/resolution must stay aligned with components/shell/storage.ts.
 */
const themeBootScript = `(function(){try{var k='ticketos.admin.theme';var p=localStorage.getItem(k);var pref=p==='light'||p==='dark'||p==='system'?p:'system';var dark=pref==='dark'||(pref==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var t=dark?'dark':'light';var r=document.documentElement;r.setAttribute('data-theme',t);r.setAttribute('data-theme-preference',pref);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className={blackTicketFontVars}>
        <Providers>
          <ToastProvider>{children}</ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
