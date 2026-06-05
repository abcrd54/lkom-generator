# LKOM Generator

Next.js app for chat and image generation. The web app can run on Vercel, while image generation runs asynchronously through Redis + BullMQ workers on a VPS.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Image Worker

Image generation uses Redis + BullMQ so long-running image requests are processed outside the web request.

Required environment:

```bash
REDIS_URL=redis://localhost:6379
IMAGE_WORKER_CONCURRENCY=5
IMAGE_QUEUE_MAX_SIZE=500
```

Run the web app and worker as separate processes:

```bash
npm run start
npm run worker:images
```

## Vercel Web + VPS Worker Setup

Use this setup when the Next.js web app runs on Vercel, while Redis, the image worker, and 9Router run on a VPS.

### 1. Prepare VPS

Copy the repository to the VPS, then create the worker env file:

```bash
cd deploy/vps
cp .env.worker.example .env.worker
```

Edit `deploy/vps/.env.worker` and fill:

```bash
REDIS_PASSWORD=change-this-long-random-password
REDIS_URL=redis://:change-this-long-random-password@redis:6379
IMAGE_WORKER_CONCURRENCY=5
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
NINEROUTER_BASE_URL=http://host.docker.internal:20128
NINEROUTER_API_KEY=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_PUBLIC_URL=...
```

Use the same Redis password in `REDIS_PASSWORD` and `REDIS_URL`. Use an alphanumeric Redis password to avoid URL escaping issues.

Start Redis and the worker:

```bash
docker compose --env-file .env.worker up -d --build
docker compose --env-file .env.worker logs -f image-worker
```

If 9Router also runs as a Docker service on the same Docker network, set `NINEROUTER_BASE_URL` to that service URL instead, for example `http://9router:20128`.

### 2. Configure Vercel

Set these environment variables in Vercel:

```bash
REDIS_URL=redis://:YOUR_REDIS_PASSWORD@YOUR_VPS_PUBLIC_IP:6379
IMAGE_QUEUE_MAX_SIZE=500
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Keep the existing 9Router and R2 variables if any API routes still need them. Image generation itself is handled by the worker, but quota/status routes still need Supabase and Redis.

### 3. Firewall Note

Because the web app runs on Vercel, Vercel must reach Redis on the VPS. The compose file exposes Redis on port `6379`. At minimum:

- use a strong `REDIS_PASSWORD`
- do not reuse that password elsewhere
- restrict port `6379` when your firewall or provider allows it
- prefer a managed Redis with TLS for production-critical workloads

For a private-only VPS Redis, the web app must also move to the VPS or use a managed/public Redis endpoint; Vercel cannot enqueue jobs into a private Docker network directly.

### 4. Operational Commands

From the repository root:

```bash
docker compose --env-file deploy/vps/.env.worker -f deploy/vps/docker-compose.yml ps
docker compose --env-file deploy/vps/.env.worker -f deploy/vps/docker-compose.yml logs -f redis
docker compose --env-file deploy/vps/.env.worker -f deploy/vps/docker-compose.yml logs -f image-worker
docker compose --env-file deploy/vps/.env.worker -f deploy/vps/docker-compose.yml restart image-worker
docker compose --env-file deploy/vps/.env.worker -f deploy/vps/docker-compose.yml pull
docker compose --env-file deploy/vps/.env.worker -f deploy/vps/docker-compose.yml up -d --build
```

Check queue counts from the web app:

```bash
curl https://your-vercel-domain.vercel.app/api/queue
```

## Expired Image Cleanup

Generated images keep their chat history, but the binary file can be removed from R2 after expiry. The cleanup script:

- finds `images` rows where `expires_at` has passed
- deletes the corresponding object from R2
- keeps the database row
- sets `r2_url = null` and `storage_deleted_at` so the chat can show that the image has expired

Run manually:

```bash
npm run cleanup:expired-images
```

Recommended VPS cron example, once per night at 02:15:

```bash
15 2 * * * cd /home/admin/lkom-generator-worker/deploy/vps && sudo -n docker compose --env-file .env.worker run --rm image-worker npm run cleanup:expired-images >> /var/log/lkom-cleanup.log 2>&1
```
