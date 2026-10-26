import { Spinner } from "./ui/Button";

export function Splash() {
  return (
    <div className="fade-in flex h-full items-center justify-center text-muted-foreground">
      <Spinner />
    </div>
  );
}
