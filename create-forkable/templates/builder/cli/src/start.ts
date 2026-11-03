import { BRAND } from "@builder/core";
import { startServer } from "@builder/server";

export async function start(_args: string[]): Promise<number> {
  try {
    const s = await startServer();
    console.log(`Open ${s.url}`);
    await new Promise<void>((resolve) => {
      const stop = () => void s.stop().finally(resolve);
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    return 0;
  } catch (err) {
    console.error(`${BRAND.name} could not start. ${(err as Error).message}`);
    return 1;
  }
}
