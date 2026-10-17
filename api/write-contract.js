import fs from "node:fs/promises";
import { openapi } from "./contract.js";
await fs.writeFile(
  new URL("./openapi.json", import.meta.url),
  JSON.stringify(openapi, null, 2),
);
console.log("Updated api/openapi.json from shared runtime schemas");
