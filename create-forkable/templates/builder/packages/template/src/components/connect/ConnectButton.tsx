import { ConnectButton as OneConnectButton } from "@withone/connect/react";
import { useMe } from "@/lib/me";

/** Sign in with One and connect tools. Users grant this app scoped access to their own accounts. */
export function ConnectButton({ logos, connector }: { logos?: string[]; connector?: string }) {
  const me = useMe();
  const ready = Boolean(me.data?.user || me.data?.canSignIn);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <OneConnectButton
        authorizeUrl="/api/one/authorize"
        logos={logos}
        connector={connector}
        connected={Boolean(me.data?.user)}
        disabled={!ready}
        description={ready ? undefined : "Sign in with One is not set up for this app yet"}
        theme="auto"
        onSuccess={() => void me.refetch()}
      />
      {me.isSuccess && !ready && <p className="text-11 text-muted-foreground">Sign in with One is not set up for this app yet.</p>}
      {me.data?.grant === "sample" && <p className="text-11 text-muted-foreground">Sample One: answers come from fixtures, not a live account.</p>}
    </div>
  );
}
