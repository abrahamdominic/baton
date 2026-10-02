"use client";

import { forgetDevice } from "@/lib/messaging/client";

/**
 * Sign-out control that clears the browser's messaging identity on the way out.
 *
 * The device ECDH private key that unwraps this browser's message thread keys
 * lives only in `localStorage` and is never sent to the server, so the server
 * cannot clear it — a plain `<a href="/auth/logout">` leaves it behind. On a
 * shared machine the next person could pair that surviving private key with
 * its still-registered public key and read every conversation the device was
 * ever issued a key wrap for.
 *
 * The key is removed *before* the request goes out so a failed or interrupted
 * request cannot skip the wipe.
 *
 * Sign-out is a POST, not a link to a GET: a state-changing GET is forgeable
 * from any page, so signing out is a same-origin action only. The click handler
 * is best-effort and never blocks the sign-out: a storage error must not strand
 * the user in a signed-in-looking UI, and if the fetch itself fails the browser
 * is still navigated to the destination.
 */
export function SignOutLink({
  className,
  children,
  onNavigate,
  next,
}: {
  className?: string;
  children: React.ReactNode;
  /** Called after the key is cleared, e.g. to close a mobile nav drawer. */
  onNavigate?: () => void;
  /** Post-sign-out path; passed through to the existing redirect sanitizer. */
  next?: string;
}) {
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    forgetDevice();
    onNavigate?.();
    const destination = next ? `/auth/logout?next=${encodeURIComponent(next)}` : "/auth/logout";
    // Awaited before navigating: the response is what clears the session cookie,
    // and leaving early would race the unload. `keepalive` covers the case where
    // the user closes the tab mid-request.
    void fetch(destination, { method: "POST", credentials: "same-origin", keepalive: true })
      .catch(() => {})
      .then(() => {
        window.location.assign(next ?? "/");
      });
  }

  return (
    <a
      href={next ? `/auth/logout?next=${encodeURIComponent(next)}` : "/auth/logout"}
      onClick={handleClick}
      className={className}
    >
      {children}
    </a>
  );
}
