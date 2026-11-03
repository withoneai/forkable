import { Compass } from "lucide-react";
import { Link } from "react-router";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <AppShell>
      <EmptyState
        icon={Compass}
        title="This page does not exist"
        description="The link may be old, or the page has not been built yet."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/">Go home</Link>
          </Button>
        }
      />
    </AppShell>
  );
}
