import { Client } from "ssh2";
import { createReadStream, existsSync, promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const rootDir = process.cwd();
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.split("=");
    return [key.replace(/^--/, ""), value.join("=") || "true"];
  })
);

const host = args.get("host");
const username = args.get("user") || "root";
const port = Number.parseInt(args.get("port") || "22", 10);
const keyPath = args.get("key") || "abcrd.ppk";
const remoteDir = args.get("dir") || `/home/${username}/lkom-generator-worker`;
const mode = args.get("mode") || "deploy";

if (!host) {
  throw new Error("Missing --host=...");
}

function parseEnv(contents) {
  const env = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    env.set(key, value);
  }
  return env;
}

async function readLocalEnv() {
  const envPath = path.join(rootDir, ".env.local");
  if (!existsSync(envPath)) {
    throw new Error(".env.local not found. Worker secrets are required.");
  }
  return parseEnv(await fs.readFile(envPath, "utf8"));
}

function requireEnv(env, key) {
  const value = env.get(key);
  if (!value) throw new Error(`Missing ${key} in .env.local`);
  return value;
}

function generatePassword() {
  return crypto.randomBytes(24).toString("base64url");
}

function normalize9RouterBaseURL(rawValue) {
  const fallback = "http://host.docker.internal:20128";
  const value = (rawValue || "").trim();
  if (!value) return fallback;

  const sanitized = value
    .replace(/\/:([0-9]+)(?=\/|$)/, ":$1")
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");

  try {
    const parsed = new URL(sanitized);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      parsed.hostname = "host.docker.internal";
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    const pathname = parsed.pathname === "/v1" ? "" : parsed.pathname;
    return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    if (/^https?:\/\//i.test(sanitized)) {
      return sanitized.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal");
    }
    return `${fallback}${sanitized.startsWith("/") ? "" : "/"}${sanitized}`;
  }
}

function connect() {
  return new Promise(async (resolve, reject) => {
    const privateKey = await readPrivateKey(path.resolve(rootDir, keyPath));
    const client = new Client();
    client
      .on("ready", () => resolve(client))
      .on("error", reject)
      .connect({
        host,
        port,
        username,
        privateKey,
        readyTimeout: 20000,
      });
  });
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function readString(buffer, offset) {
  const length = readUInt32(buffer, offset);
  const start = offset + 4;
  const end = start + length;
  return { value: buffer.subarray(start, end), offset: end };
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function writeString(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([writeUInt32(buffer.length), buffer]);
}

function writeMpint(value) {
  let buffer = Buffer.from(value);
  while (buffer.length > 1 && buffer[0] === 0 && (buffer[1] & 0x80) === 0) {
    buffer = buffer.subarray(1);
  }
  if (buffer.length > 0 && (buffer[0] & 0x80) !== 0) {
    buffer = Buffer.concat([Buffer.from([0]), buffer]);
  }
  return writeString(buffer);
}

function readPpkBlock(lines, label) {
  const header = `${label}-Lines:`;
  const index = lines.findIndex((line) => line.startsWith(header));
  if (index === -1) throw new Error(`Invalid PPK: missing ${header}`);
  const count = Number.parseInt(lines[index].slice(header.length).trim(), 10);
  return Buffer.from(lines.slice(index + 1, index + 1 + count).join(""), "base64");
}

async function readPrivateKey(filePath) {
  const raw = await fs.readFile(filePath);
  const text = raw.toString("utf8");
  if (!text.startsWith("PuTTY-User-Key-File-")) {
    return raw;
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  const keyType = lines[0].split(":")[1]?.trim();
  const encryption = lines.find((line) => line.startsWith("Encryption:"))?.split(":")[1]?.trim();
  const comment = lines.find((line) => line.startsWith("Comment:"))?.slice("Comment:".length).trim() || "";

  if (keyType !== "ssh-rsa") {
    throw new Error(`Unsupported PPK key type: ${keyType}`);
  }
  if (encryption !== "none") {
    throw new Error("Encrypted PPK keys require conversion with puttygen first");
  }

  const publicBlob = readPpkBlock(lines, "Public");
  const privateBlob = readPpkBlock(lines, "Private");

  let publicOffset = 0;
  const publicType = readString(publicBlob, publicOffset);
  publicOffset = publicType.offset;
  const e = readString(publicBlob, publicOffset);
  publicOffset = e.offset;
  const n = readString(publicBlob, publicOffset);

  let privateOffset = 0;
  const d = readString(privateBlob, privateOffset);
  privateOffset = d.offset;
  const p = readString(privateBlob, privateOffset);
  privateOffset = p.offset;
  const q = readString(privateBlob, privateOffset);
  privateOffset = q.offset;
  const iqmp = readString(privateBlob, privateOffset);

  const check = crypto.randomBytes(4);
  let privateSection = Buffer.concat([
    check,
    check,
    writeString("ssh-rsa"),
    writeMpint(n.value),
    writeMpint(e.value),
    writeMpint(d.value),
    writeMpint(iqmp.value),
    writeMpint(p.value),
    writeMpint(q.value),
    writeString(comment),
  ]);

  const paddingLength = 8 - (privateSection.length % 8 || 8);
  if (paddingLength > 0 && paddingLength < 8) {
    privateSection = Buffer.concat([
      privateSection,
      Buffer.from(Array.from({ length: paddingLength }, (_, index) => index + 1)),
    ]);
  }

  const openssh = Buffer.concat([
    Buffer.from("openssh-key-v1\0"),
    writeString("none"),
    writeString("none"),
    writeString(Buffer.alloc(0)),
    writeUInt32(1),
    writeString(publicBlob),
    writeString(privateSection),
  ]);

  const b64 = openssh.toString("base64").match(/.{1,70}/g)?.join("\n") || "";
  return Buffer.from(`-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`);
}

function exec(client, command, options = {}) {
  return new Promise((resolve, reject) => {
    client.exec(command, options, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`Command failed (${code}): ${command}\n${stderr || stdout}`));
          }
        })
        .on("data", (data) => {
          stdout += data.toString();
          if (!options.quiet) process.stdout.write(data);
        });
      stream.stderr.on("data", (data) => {
        stderr += data.toString();
        if (!options.quiet) process.stderr.write(data);
      });
    });
  });
}

function sftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftpClient) => {
      if (error) reject(error);
      else resolve(sftpClient);
    });
  });
}

function shouldSkip(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized === ".next" ||
    normalized.startsWith(".next/") ||
    normalized === ".vercel" ||
    normalized.startsWith(".vercel/") ||
    normalized === ".env" ||
    normalized === ".env.local" ||
    normalized.endsWith(".ppk") ||
    normalized === "deploy/vps/.env.worker"
  );
}

async function listFiles(dir, base = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath);
    if (shouldSkip(relativePath)) continue;
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath, base));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function mkdir(sftpClient, remotePath) {
  return new Promise((resolve) => {
    sftpClient.mkdir(remotePath, () => resolve());
  });
}

async function ensureRemoteDir(sftpClient, remotePath) {
  const parts = remotePath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    await mkdir(sftpClient, current);
  }
}

function uploadFile(sftpClient, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const readStream = createReadStream(localPath);
    const writeStream = sftpClient.createWriteStream(remotePath);
    writeStream.on("close", resolve);
    writeStream.on("error", reject);
    readStream.on("error", reject);
    readStream.pipe(writeStream);
  });
}

async function uploadProject(client) {
  const sftpClient = await sftp(client);
  await exec(client, `rm -rf ${remoteDir}.new && mkdir -p ${remoteDir}.new`, { quiet: true });

  const files = await listFiles(rootDir);
  let uploaded = 0;
  for (const relativePath of files) {
    const remotePath = `${remoteDir}.new/${relativePath.replaceAll("\\", "/")}`;
    await ensureRemoteDir(sftpClient, path.posix.dirname(remotePath));
    await uploadFile(sftpClient, path.join(rootDir, relativePath), remotePath);
    uploaded += 1;
    if (uploaded % 50 === 0) {
      console.log(`[deploy] uploaded ${uploaded}/${files.length}`);
    }
  }
  console.log(`[deploy] uploaded ${uploaded} files`);

  await exec(
    client,
    `rm -rf ${remoteDir}.old && if [ -d ${remoteDir} ]; then mv ${remoteDir} ${remoteDir}.old; fi && mv ${remoteDir}.new ${remoteDir}`,
    { quiet: true }
  );
}

async function writeWorkerEnv(client) {
  const env = await readLocalEnv();
  const redisPassword = generatePassword();
  const worker9RouterUrl = normalize9RouterBaseURL(env.get("NINEROUTER_BASE_URL"));
  const lines = [
    `REDIS_PASSWORD=${redisPassword}`,
    `REDIS_URL=redis://:${redisPassword}@redis:6379`,
    `IMAGE_WORKER_CONCURRENCY=${env.get("IMAGE_WORKER_CONCURRENCY") || "5"}`,
    `NEXT_PUBLIC_SUPABASE_URL=${requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL")}`,
    `SUPABASE_SERVICE_ROLE_KEY=${requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY")}`,
    `NINEROUTER_BASE_URL=${worker9RouterUrl}`,
    `NINEROUTER_API_KEY=${requireEnv(env, "NINEROUTER_API_KEY")}`,
    `R2_ACCOUNT_ID=${requireEnv(env, "R2_ACCOUNT_ID")}`,
    `R2_ACCESS_KEY_ID=${requireEnv(env, "R2_ACCESS_KEY_ID")}`,
    `R2_SECRET_ACCESS_KEY=${requireEnv(env, "R2_SECRET_ACCESS_KEY")}`,
    `R2_BUCKET_NAME=${requireEnv(env, "R2_BUCKET_NAME")}`,
    `R2_PUBLIC_URL=${requireEnv(env, "R2_PUBLIC_URL")}`,
  ];

  const tempFile = `${remoteDir}/deploy/vps/.env.worker.tmp`;
  const finalFile = `${remoteDir}/deploy/vps/.env.worker`;
  const escaped = Buffer.from(lines.join("\n") + "\n", "utf8").toString("base64");
  await exec(client, `printf '%s' '${escaped}' | base64 -d > ${tempFile} && chmod 600 ${tempFile} && mv ${tempFile} ${finalFile}`, { quiet: true });
  return redisPassword;
}

async function main() {
  const client = await connect();
  try {
    console.log(`[deploy] connected to ${username}@${host}`);
    await exec(client, "uname -a && whoami && docker --version && docker compose version");
    let docker = "docker";
    try {
      await exec(client, "docker ps >/dev/null", { quiet: true });
    } catch {
      await exec(client, "sudo -n docker ps >/dev/null", { quiet: true });
      docker = "sudo -n docker";
    }

    if (mode === "check") return;
    if (mode === "network-check") {
      await exec(client, [
        "set -e",
        "REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region || true)",
        "INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id || true)",
        "echo region=$REGION instance=$INSTANCE_ID",
        "aws sts get-caller-identity --output json || true",
        "aws ec2 describe-instances --region $REGION --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].SecurityGroups' --output json || true",
        "aws lightsail get-instances --region $REGION --query 'instances[].{name:name,publicIpAddress:publicIpAddress,ports:networking.ports}' --output json || true",
        "sudo -n ss -ltnp | grep 6379 || true",
      ].join(" && "));
      return;
    }
    if (mode === "open-redis") {
      await exec(client, [
        "set -e",
        "REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)",
        "INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)",
        "SG=$(aws ec2 describe-instances --region $REGION --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text 2>/dev/null || true)",
        "if [ -n \"$SG\" ] && [ \"$SG\" != \"None\" ]; then aws ec2 authorize-security-group-ingress --region $REGION --group-id $SG --protocol tcp --port 6379 --cidr 0.0.0.0/0 || true; else echo 'No EC2 security group found'; fi",
      ].join(" && "));
      return;
    }
    if (mode === "exec") {
      const command = args.get("cmd");
      if (!command) throw new Error("Missing --cmd=...");
      await exec(client, command);
      return;
    }

    await uploadProject(client);
    const redisPassword = await writeWorkerEnv(client);

    await exec(
      client,
      `cd ${remoteDir}/deploy/vps && ${docker} compose --env-file .env.worker up -d --build && ${docker} compose --env-file .env.worker ps`
    );

    console.log("[deploy] done");
    console.log(`[deploy] set this in Vercel: REDIS_URL=redis://:${redisPassword}@${host}:6379`);
  } finally {
    client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
