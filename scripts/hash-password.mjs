// Usage: npm run hash-password
// Prints a hash to put in ADMIN_PASSWORD_HASH. The password itself is never stored.
import { createInterface } from "node:readline";
import { hashPassword } from "../server/auth.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question("Password to hash: ", pw => {
  rl.close();
  if (!pw || pw.length < 8) { console.error("Use at least 8 characters."); process.exit(1); }
  console.log("\nADMIN_PASSWORD_HASH=" + hashPassword(pw));
});
