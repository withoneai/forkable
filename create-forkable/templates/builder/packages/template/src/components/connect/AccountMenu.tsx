import { LogIn, PlugZap } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { initials, useMe } from "@/lib/me";

/** Who is signed in, with Connected tools; Sign in when nobody is. */
export function AccountMenu() {
  const me = useMe();
  if (me.isPending) return <span className="size-7 rounded-full bg-muted" aria-hidden />;
  const user = me.data?.user;
  if (!user) {
    const can = Boolean(me.data?.canSignIn);
    return (
      <Button asChild={can} variant="ghost" size="sm" disabled={!can} title={can ? undefined : "Sign in with One is not set up for this app yet"}>
        {can ? (
          <a href="/api/one/authorize">
            <LogIn /> Sign in
          </a>
        ) : (
          <>
            <LogIn /> Sign in
          </>
        )}
      </Button>
    );
  }
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button type="button" className="flex h-8 items-center gap-2 rounded-md px-1.5 text-13 hover:bg-muted" aria-label="Account">
          <span className="flex size-6 items-center justify-center rounded-full bg-accent/15 text-10 font-semibold text-accent">{initials(user.name, user.email)}</span>
          <span className="hidden max-w-32 truncate sm:inline">{user.name ?? user.email}</span>
        </button>
      </DropdownTrigger>
      <DropdownContent align="end" className="min-w-52">
        <DropdownLabel className="normal-case tracking-normal">
          <span className="block truncate text-13 font-medium text-foreground">{user.name ?? "Signed in"}</span>
          {user.email && <span className="block truncate text-11 font-normal">{user.email}</span>}
          {me.data?.previewUser && <span className="block text-11 font-normal">Not signed in. Turn on One Connect in the project's Settings to sign in with One.</span>}
        </DropdownLabel>
        <DropdownSeparator />
        <DropdownItem asChild>
          <Link to="/access">
            <PlugZap /> Connected tools
          </Link>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
