/**
 * Where to send someone after they sign in.
 *
 * The sign-in address can carry ?next=<page> so a visitor returns to what they were opening. Two problems with using it
 * blindly: it must be a local path (never another site), and the admin-section pages must not become the landing page
 * of a normal user (an admin who signed out on /nifty-shorts left that page behind for whoever signed in next).
 */
// The pages the administrator navigation links to and the normal navigation does not.
const ADMIN_SECTION = ["/admin", "/nifty-shorts", "/regulatory", "/news-feed"];

export const isAdminSectionPath = (path: string) =>
  ADMIN_SECTION.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));

function localPath(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && next !== "/" ? next : null;
}

export function postLoginTarget(next: string | null | undefined, isAdmin: boolean) {
  const requested = localPath(next);
  if (isAdmin) return requested && requested.startsWith("/admin") ? requested : "/admin";
  return requested && !isAdminSectionPath(requested) ? requested : "/home";
}
