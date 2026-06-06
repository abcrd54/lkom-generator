import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = {
    envFile: ".env.local",
    emailFile: "scripts/supabase-auth-emails.txt",
    password: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--env-file") {
      args.envFile = argv[i + 1] || args.envFile;
      i += 1;
      continue;
    }

    if (arg === "--email-file") {
      args.emailFile = argv[i + 1] || args.emailFile;
      i += 1;
      continue;
    }

    if (arg === "--password") {
      args.password = argv[i + 1] || args.password;
      i += 1;
      continue;
    }
  }

  return args;
}

function loadEnvFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadEmails(filePath) {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const uniqueEmails = [];
  const duplicates = [];
  const invalid = [];
  const seen = new Set();

  for (const email of lines) {
    const normalized = email.toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      invalid.push(email);
      continue;
    }

    if (seen.has(normalized)) {
      duplicates.push(email);
      continue;
    }

    seen.add(normalized);
    uniqueEmails.push(normalized);
  }

  return { uniqueEmails, duplicates, invalid };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.password) {
    throw new Error("Missing required argument: --password");
  }

  loadEnvFile(args.envFile);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const { uniqueEmails, duplicates, invalid } = loadEmails(args.emailFile);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let created = 0;
  let existing = 0;
  const failures = [];

  for (const email of uniqueEmails) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: args.password,
      email_confirm: true,
    });

    if (!error) {
      created += 1;
      console.log(`[created] ${email} (${data.user?.id || "no-id"})`);
      continue;
    }

    if (
      error.message.toLowerCase().includes("already") ||
      error.message.toLowerCase().includes("registered") ||
      error.message.toLowerCase().includes("exists")
    ) {
      existing += 1;
      console.log(`[exists] ${email}`);
      continue;
    }

    failures.push({ email, message: error.message });
    console.log(`[failed] ${email}: ${error.message}`);
  }

  console.log("");
  console.log("Summary");
  console.log(`total_input=${uniqueEmails.length + duplicates.length + invalid.length}`);
  console.log(`valid_unique=${uniqueEmails.length}`);
  console.log(`created=${created}`);
  console.log(`already_exists=${existing}`);
  console.log(`duplicates_in_file=${duplicates.length}`);
  console.log(`invalid_emails=${invalid.length}`);
  console.log(`failed=${failures.length}`);

  if (duplicates.length) {
    console.log("");
    console.log("Duplicates skipped:");
    for (const email of duplicates) {
      console.log(`- ${email}`);
    }
  }

  if (invalid.length) {
    console.log("");
    console.log("Invalid skipped:");
    for (const email of invalid) {
      console.log(`- ${email}`);
    }
  }

  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
