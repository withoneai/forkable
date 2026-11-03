// The top bar's links. Add a page here when you add it to the router in
// src/main.tsx. `signedIn: true` hides the link from visitors who are not
// signed in (staff and admin pages); the page itself still guards with
// <SignInGate>.

export interface NavItem {
  to: string;
  label: string;
  signedIn?: boolean;
}

export const NAV: NavItem[] = [{ to: "/", label: "Home" }];
