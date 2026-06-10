# LHC Cafe — Deployment Guide

A step-by-step guide for running LHC Cafe on your own machine and hosting it publicly for free.

---

## Part 1 — Run Locally on Your Computer

### Prerequisites

Install the following on your machine before starting:

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 20 or 22 LTS | https://nodejs.org |
| pnpm | Latest | `npm install -g pnpm` |
| PostgreSQL | 15 or 16 | https://www.postgresql.org/download/ |
| Git | Any recent | https://git-scm.com |

---

### Step 1 — Get the Code

Open a terminal and run:

```bash
# If you downloaded a zip from Replit, unzip it and cd into the folder
cd lhc-cafe

# OR if you have a Git URL:
git clone <your-repo-url> lhc-cafe
cd lhc-cafe
```

---

### Step 2 — Install Dependencies

```bash
pnpm install
```

This installs all packages for the API server, frontend, and shared libraries.

---

### Step 3 — Set Up PostgreSQL

#### On Windows (using pgAdmin or psql)
1. Open **pgAdmin** or the **psql** shell.
2. Create a database:
   ```sql
   CREATE DATABASE lhc_cafe;
   CREATE USER lhc_user WITH PASSWORD 'your_password_here';
   GRANT ALL PRIVILEGES ON DATABASE lhc_cafe TO lhc_user;
   ```

#### On macOS (using Homebrew)
```bash
brew install postgresql@16
brew services start postgresql@16
createdb lhc_cafe
```

#### On Linux (Ubuntu/Debian)
```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE lhc_cafe;"
sudo -u postgres psql -c "CREATE USER lhc_user WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE lhc_cafe TO lhc_user;"
```

---

### Step 4 — Configure Environment Variables

Create a file called `.env` in the **project root** (the same folder as `package.json`):

```env
# PostgreSQL connection string — adjust host/user/password/dbname to match Step 3
DATABASE_URL=postgresql://lhc_user:your_password@localhost:5432/lhc_cafe

# A long random string used to sign login tokens — change this!
SESSION_SECRET=change_this_to_a_long_random_string_at_least_32_chars
```

> **Tip:** Generate a secure SESSION_SECRET with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

### Step 5 — Push the Database Schema

This creates all tables in your database:

```bash
pnpm --filter @workspace/db run push
```

You should see confirmation that tables were created.

---

### Step 6 — Seed Default Users

The database needs at least one admin account. Run this to create the defaults:

```bash
pnpm --filter @workspace/api-server run seed
```

This creates:
- **Admin**: username `admin`, password `admin123`
- **Staff**: username `staff1`, password `staff123`

> **Important:** Change these passwords after first login via Admin → Users.

---

### Step 7 — Start the Application

Open **two terminal windows** (or use two tabs):

**Terminal 1 — API Server:**
```bash
pnpm --filter @workspace/api-server run dev
```
The API will start on `http://localhost:8080`

**Terminal 2 — Frontend:**
```bash
pnpm --filter @workspace/lhc-cafe run dev
```
The frontend will start and show a URL like `http://localhost:18096`

---

### Step 8 — Open in Browser

Navigate to the URL shown by the frontend (e.g. `http://localhost:18096`) and log in with `admin` / `admin123`.

---

### Running as a Production Build Locally

For faster performance (no hot-reload overhead):

```bash
# Build everything
pnpm run build

# Start the API server in production mode
NODE_ENV=production pnpm --filter @workspace/api-server start
```

Then serve the frontend static files with any static server:
```bash
npx serve artifacts/lhc-cafe/dist -p 3000
```

Open `http://localhost:3000`.

---

## Part 2 — Host Publicly for Free

Several platforms offer free tiers suitable for LHC Cafe. Here are the best options in order of recommendation:

---

### Option A — Railway (Recommended)

**Why:** Free $5/month credit, full PostgreSQL included, simple GitHub deploy, fast cold starts.

#### Step 1 — Push Code to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
gh repo create lhc-cafe --private --push
# OR push manually to github.com
```

#### Step 2 — Sign Up & Connect
1. Go to https://railway.app and sign up with GitHub.
2. Click **New Project → Deploy from GitHub repo**.
3. Select your `lhc-cafe` repository.

#### Step 3 — Add a PostgreSQL Database
1. In your Railway project, click **+ New → Database → PostgreSQL**.
2. Railway automatically sets `DATABASE_URL` in your project environment.

#### Step 4 — Set Environment Variables
In Railway → your service → **Variables**, add:
```
SESSION_SECRET=<your long random string>
NODE_ENV=production
```

#### Step 5 — Configure the Build & Start Commands
In Railway → service → **Settings**:
- **Build Command:** `pnpm install && pnpm run build`
- **Start Command:** `node artifacts/api-server/dist/index.js`
- **Root Directory:** leave blank (project root)

#### Step 6 — Deploy the Frontend as a Static Site
Railway can't serve a Vite SPA from the same service easily. Options:
- Add a second Railway service with **Start Command:** `npx serve artifacts/lhc-cafe/dist -p $PORT`
- Or use **Vercel** (free) for the frontend (see Option C below for details)

#### Step 7 — Update API URL
In `artifacts/lhc-cafe/.env.production` (create if absent):
```
VITE_API_BASE=https://your-api-service.railway.app
```
Then redeploy.

---

### Option B — Render (Very Easy Setup)

**Why:** Completely free tier, auto-deploys from GitHub, built-in PostgreSQL.

> **Note:** Free tier services spin down after 15 minutes of inactivity and take ~30 seconds to wake up on the first request. Paid plan ($7/mo) removes this.

#### Step 1 — Push to GitHub (same as Option A Step 1)

#### Step 2 — Create a Web Service
1. Go to https://render.com and sign up.
2. Click **New → Web Service → Connect GitHub repo**.
3. Set:
   - **Build Command:** `pnpm install && pnpm run build`
   - **Start Command:** `node artifacts/api-server/dist/index.js`
   - **Environment:** Node

#### Step 3 — Add PostgreSQL
1. Click **New → PostgreSQL** in Render dashboard.
2. Copy the **Internal Database URL** into your web service's environment variables as `DATABASE_URL`.

#### Step 4 — Add Environment Variables
In Render → Web Service → **Environment**:
```
SESSION_SECRET=<your long random string>
NODE_ENV=production
PORT=10000
```

#### Step 5 — Deploy Frontend as Static Site
1. Click **New → Static Site**.
2. Connect the same repo.
3. Set:
   - **Build Command:** `pnpm install && pnpm --filter @workspace/lhc-cafe run build`
   - **Publish Directory:** `artifacts/lhc-cafe/dist`
4. Add environment variable:
   ```
   VITE_API_BASE=https://your-api-service.onrender.com
   ```

---

### Option C — Vercel (Frontend) + Railway or Render (Backend)

**Why:** Vercel is the fastest free CDN for React apps globally. Combine with Railway/Render for the API.

#### Frontend on Vercel
1. Go to https://vercel.com → **Add New → Project → Import Git Repository**.
2. Set:
   - **Framework Preset:** Vite
   - **Root Directory:** `artifacts/lhc-cafe`
   - **Build Command:** `pnpm run build`
   - **Output Directory:** `dist`
3. Add environment variable:
   ```
   VITE_API_BASE=https://your-api.railway.app
   ```
4. Click Deploy. Vercel gives you a `.vercel.app` domain instantly.

#### Backend on Railway (from Option A above)
Deploy only the API server following Option A Steps 1–6.

---

### Option D — Fly.io (Good for Full-Stack)

**Why:** Free tier with 3 shared VMs, persistent volumes, global edge network.

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch (run from project root)
fly launch

# Set secrets
fly secrets set SESSION_SECRET="your_secret_here"
fly secrets set DATABASE_URL="postgresql://..."

# Deploy
fly deploy
```

Create a `fly.toml` in project root:
```toml
app = "lhc-cafe"
primary_region = "sin"   # Singapore — closest to Nepal

[build]
  [build.args]
    NODE_VERSION = "22"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

For the database, use **Fly Postgres**:
```bash
fly postgres create --name lhc-cafe-db --region sin
fly postgres attach --app lhc-cafe lhc-cafe-db
```

---

## Performance Tips

To make the app feel fast and responsive in production:

### 1. Enable Gzip Compression in the API
Add to `artifacts/api-server/src/index.ts`:
```typescript
import compression from "compression";
app.use(compression());
```
Install: `pnpm --filter @workspace/api-server add compression`

### 2. Cache Static Assets
The Vite build already adds content hashes to JS/CSS filenames. Configure your hosting to set long cache headers for `/assets/*`:
```
Cache-Control: public, max-age=31536000, immutable
```

### 3. Use Connection Pooling for PostgreSQL
In production with multiple workers, use PgBouncer or `DATABASE_URL` with `?pool_timeout=10&connection_limit=10`.

### 4. Set NODE_ENV=production
This disables React development warnings and enables optimized builds:
```
NODE_ENV=production
```

### 5. Choose a Nearby Region
- Railway: `ap-southeast-1` (Singapore) — closest to Nepal
- Render: Singapore region
- Fly.io: `sin` (Singapore)

---

## Summary Comparison

| Platform | Free Tier | Cold Start | PostgreSQL Included | Best For |
|----------|-----------|------------|---------------------|----------|
| Railway | $5 credit/mo | Fast (<1s) | Yes (free) | Full-stack, easiest |
| Render | 750 hrs/mo | Slow (30s) | Yes (free 90 days) | Simple projects |
| Vercel | Unlimited | None (CDN) | No (frontend only) | Frontend speed |
| Fly.io | 3 VMs free | Fast | No (extra) | Control & regions |

**Recommendation for LHC Cafe:**
- **Quickest setup:** Render (backend + database + frontend, all free, one platform)
- **Best performance:** Railway API + Vercel frontend
- **Most control:** Fly.io

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `DATABASE_URL` connection refused | Check PostgreSQL is running; verify host/port/credentials |
| `SESSION_SECRET` error on startup | Make sure `.env` is in the project root, not in a subfolder |
| White screen on frontend | Check browser console; make sure `VITE_API_BASE` points to your live API |
| CORS errors | The API already allows all origins in dev; in production set `CORS_ORIGIN=https://your-frontend.com` |
| Tables not found | Run `pnpm --filter @workspace/db run push` again after connecting to the production database |
| pnpm not found | Run `npm install -g pnpm` then restart your terminal |
