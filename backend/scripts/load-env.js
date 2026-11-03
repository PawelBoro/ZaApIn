// Loads the env file named by ENV_FILE (default .env). For any other file,
// e.g. .env.production, it shows the target database and asks before going on,
// so a production script is not run by mistake.
const readline = require("node:readline/promises");

const envFile = process.env.ENV_FILE ?? ".env";
require("dotenv").config({ path: envFile });

async function confirmTarget() {
  if (envFile === ".env") return;
  console.log(`Env file: ${envFile}`);
  console.log(`DB_HOST:  ${process.env.DB_HOST}`);
  console.log(`DB_NAME:  ${process.env.DB_NAME}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Continue? (y/N) ");
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(1);
  }
}

module.exports = { confirmTarget };
