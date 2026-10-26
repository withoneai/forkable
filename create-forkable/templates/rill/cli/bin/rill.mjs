#!/usr/bin/env node
// Runs the TypeScript sources through tsx. A built dist comes later.
import { tsImport } from "tsx/esm/api";
await tsImport("../src/index.ts", import.meta.url);
