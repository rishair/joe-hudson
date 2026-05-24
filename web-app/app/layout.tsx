import type { Metadata } from 'next';
import './globals.css';
import { Welcome } from './components/welcome';
import { HelpIcon } from './components/help-icon';

export const metadata: Metadata = {
  title: 'Joe Hudson Coach (G-010 web-app)',
  description: 'Minimal chat scaffold (E-040). Real coach lands in E-043.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en">
      <body>
        {children}
        {/* E-045 welcome flow + help icon. Both client components, mounted
            once at the app shell so they overlay any future route (chat
            today, wiki in E-042). The Welcome auto-opens on first visit
            (localStorage.welcomeAcknowledged !== 'true'); HelpIcon dispatches
            a window event to reopen it later. */}
        <Welcome />
        <HelpIcon />
      </body>
    </html>
  );
}
