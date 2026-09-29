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
 * The key is removed *before* navigating so a failed or interrupted redirect
 * cannot skip the wipe. The click handler is best-effort and never cancels the
 * navigation: the server session is revoked by the link itself regardless, and
 * a storage error must never strand a user in a signed-in-looking UI.
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
  function handleClick() {
    forgetDevice();
    onNavigate?.();
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
