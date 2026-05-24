import type { Metadata } from 'next';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import './globals.css';
import { Welcome } from './components/welcome';
import { HelpIcon } from './components/help-icon';

export const metadata: Metadata = {
  title: 'Joe Hudson Coach (G-010 web-app)',
  description: 'Local-first chat with a Joe Hudson coach + browsable compendium.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en">
      <body>
        {/* E-044: NuqsAdapter must wrap any component that uses useQueryState.
            Wrapping the entire shell keeps the adapter setup at one place and
            costs nothing for routes that don't use URL state. */}
        <NuqsAdapter>
          {children}
          {/* E-045 welcome flow + help icon. Both client components, mounted
              once at the app shell so they overlay any future route (chat
              today, wiki in E-042). The Welcome auto-opens on first visit
              (localStorage.welcomeAcknowledged !== 'true'); HelpIcon dispatches
              a window event to reopen it later. */}
          <Welcome />
          <HelpIcon />
          {/* E-044: portal target for the resource-attribution modal. Sits at
              the body root so the native <dialog>'s top-layer rendering and
              backdrop overlay everything regardless of the route's stacking
              context. */}
          <div id="modal-root" />
        </NuqsAdapter>
      </body>
    </html>
  );
}
