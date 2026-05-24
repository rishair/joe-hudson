'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// E-045 first-visit welcome flow.
//
// Behavior:
// - Mounts globally in layout.tsx so it overlays whatever page the user
//   landed on (chat today, wiki in E-042).
// - Shows automatically on first visit (when localStorage.welcomeAcknowledged
//   is not 'true').
// - Help icon (top-right) re-opens the modal at any later visit. Reopened
//   modal shows a [Close] button rather than [I got it →] since the user
//   has already acknowledged once.
// - Dismissing the first-visit modal writes welcomeAcknowledged='true' and
//   the modal does not auto-open again until the user clears site data.
// - Uses the native <dialog> element via .showModal() / .close() so we get
//   the platform's focus trap, escape-to-close, backdrop click semantics,
//   and ARIA modal role without a dependency. R-017 chose the same pattern
//   for E-044's resource modal; this experiment is the first to land it.
// - No analytics, no remote calls, no metrics. localStorage is the only
//   persistence surface this component touches.

const STORAGE_KEY = 'welcomeAcknowledged';

export function Welcome(): React.ReactElement {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const dismissButtonRef = useRef<HTMLButtonElement | null>(null);
  // hasAcknowledged tracks whether the user has *ever* dismissed this modal.
  // Determines the button label ('I got it →' for first-time, 'Close' for
  // help-icon re-opens) and whether to auto-open on mount.
  const [hasAcknowledged, setHasAcknowledged] = useState<boolean | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Read localStorage once on mount. Setting state to a definite boolean
  // also signals the first render-pass that read happened (vs initial null).
  useEffect(() => {
    const acknowledged =
      typeof window !== 'undefined' &&
      window.localStorage.getItem(STORAGE_KEY) === 'true';
    setHasAcknowledged(acknowledged);
    if (!acknowledged) setIsOpen(true);
  }, []);

  // Drive the native <dialog> imperatively. React 19 still treats <dialog>
  // as an uncontrolled element; .showModal() and .close() are the supported
  // surface. Calling .showModal() on an already-open dialog throws, so guard
  // on the current openness via .open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Move keyboard focus to the dismiss button when the dialog opens so a
  // sighted-keyboard or screen-reader user can press enter immediately.
  // Native <dialog>'s focus trap keeps tab cycles inside.
  useEffect(() => {
    if (isOpen) dismissButtonRef.current?.focus();
  }, [isOpen]);

  // Listen for the 'open-welcome' custom event from the help icon. Using a
  // window event rather than prop-drilling keeps Welcome and HelpIcon as
  // siblings in layout.tsx without a shared parent component.
  useEffect(() => {
    const onOpen = (): void => setIsOpen(true);
    window.addEventListener('open-welcome', onOpen);
    return () => window.removeEventListener('open-welcome', onOpen);
  }, []);

  // The native <dialog>'s built-in close events fire when the user presses
  // escape or the backdrop dismisses it; reflect that into React state and
  // persist the acknowledgement.
  const onClose = useCallback((): void => {
    setIsOpen(false);
    if (!hasAcknowledged) {
      window.localStorage.setItem(STORAGE_KEY, 'true');
      setHasAcknowledged(true);
    }
  }, [hasAcknowledged]);

  const onDismissClick = useCallback((): void => {
    onClose();
  }, [onClose]);

  // Treat a click on the backdrop (the dialog element itself, not its inner
  // content) as a dismiss. The native dialog handles escape automatically;
  // we hook the close event below to reconcile state.
  const onDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>): void => {
      if (e.target === dialogRef.current) onClose();
    },
    [onClose],
  );

  // Native dialog fires 'close' when escape is pressed; without this hook,
  // React's isOpen would drift out of sync from the actual DOM state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handler = (): void => {
      // The dialog is now closed in the DOM; sync React state without
      // re-entering .close() via the isOpen effect.
      setIsOpen(false);
      if (!hasAcknowledged) {
        window.localStorage.setItem(STORAGE_KEY, 'true');
        setHasAcknowledged(true);
      }
    };
    dialog.addEventListener('close', handler);
    return () => dialog.removeEventListener('close', handler);
  }, [hasAcknowledged]);

  // Render nothing until the localStorage read completes. Avoids a flash of
  // the welcome modal on hydration for returning users.
  if (hasAcknowledged === null) return <></>;

  const buttonLabel = hasAcknowledged ? 'Close' : 'I got it →';

  return (
    <dialog
      ref={dialogRef}
      onClick={onDialogClick}
      aria-labelledby="welcome-title"
      style={{
        width: 'min(640px, 92vw)',
        maxHeight: '85vh',
        padding: 0,
        border: '1px solid #d0d0d0',
        borderRadius: 14,
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        background: '#fff',
        color: '#1a1a1a',
      }}
    >
      <div
        style={{
          padding: '28px 32px',
          maxHeight: '85vh',
          overflowY: 'auto',
          lineHeight: 1.55,
          fontSize: 15,
        }}
      >
        <h2
          id="welcome-title"
          style={{
            fontSize: 22,
            margin: '0 0 8px',
            fontWeight: 600,
            letterSpacing: -0.2,
          }}
        >
          Welcome
        </h2>
        <p style={{ color: '#666', margin: '0 0 24px', fontSize: 14 }}>
          A short orientation before you start. About a minute to read.
        </p>

        <Section title="What this is">
          <p>
            An AI coach inspired by Joe Hudson&rsquo;s Art of Accomplishment
            methodology. Bring something you&rsquo;re stuck on, something
            you&rsquo;re avoiding, or something you can&rsquo;t quite name.
            The coach asks rather than advises.
          </p>
          <p style={{ fontStyle: 'italic', color: '#555' }}>
            This project is independent. It is not affiliated with, endorsed
            by, or operated by Joe Hudson or Art of Accomplishment. It draws
            on publicly available content (podcasts, videos, talks).
          </p>
        </Section>

        <Section title="How it was built">
          <p>
            Joe&rsquo;s publicly available conversations were transcribed and
            structured into a compendium of his reads, moves, questions,
            frameworks, and anti-patterns. A retrieval system surfaces the
            right pieces of that compendium per turn; an LLM generates the
            coach response grounded in what&rsquo;s surfaced. You can browse
            the compendium directly via the Wiki tab.
          </p>
        </Section>

        <Section title="Privacy">
          <p>
            Your conversations are stored <strong>only in your browser</strong>{' '}
            (local SQLite via OPFS). They never reach our servers. Your
            messages do travel to OpenRouter and onward to an LLM provider
            for the coach&rsquo;s response &mdash; that is the only network
            egress. Closing your browser keeps your conversations safe
            locally; clearing site data deletes them.
          </p>
          <p>
            We may add an optional anonymous feedback mechanism later (e.g.,
            a thumbs-up / thumbs-down on a message). Nothing is sent without
            your explicit click.
          </p>
        </Section>

        <Section title="Get started">
          <p>One sentence to start. For example:</p>
          <ul
            style={{
              margin: '4px 0 12px',
              paddingLeft: 22,
              color: '#333',
            }}
          >
            <li>
              <em>&ldquo;Something I&rsquo;ve been avoiding deciding.&rdquo;</em>
            </li>
            <li>
              <em>&ldquo;A pattern I keep falling into.&rdquo;</em>
            </li>
            <li>
              <em>
                &ldquo;I&rsquo;m stuck on something but I can&rsquo;t name
                what.&rdquo;
              </em>
            </li>
          </ul>
          <p>Or anything else on your mind.</p>
        </Section>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 8,
          }}
        >
          <button
            ref={dismissButtonRef}
            type="button"
            onClick={onDismissClick}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              background: '#1a73e8',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section style={{ marginBottom: 20 }}>
      <h3
        style={{
          fontSize: 14,
          margin: '0 0 8px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: '#888',
        }}
      >
        {title}
      </h3>
      <div style={{ color: '#222' }}>{children}</div>
    </section>
  );
}
