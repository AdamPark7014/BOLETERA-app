# DEVELOPMENT ENVIRONMENT SETUP

> **Complete Setup Guide for BOLETERA Development**

---

## 🔧 PREREQUISITES

Before you start, ensure you have installed:

- **Node.js** 18+ (download from [nodejs.org](https://nodejs.org))
- **pnpm** 8.0+ (install via `npm install -g pnpm`)
- **PostgreSQL** 14+ (running on localhost:5432)
- **Redis** 7+ (running on localhost:6379)
- **Git** (for version control)

### **Verify Installation**

```bash
node --version         # Should be v18+
pnpm --version        # Should be 8.0+
psql --version        # Should be 14+
redis-cli ping        # Should return PONG
```

---

## 📦 CLONE & INSTALL

```bash
# Clone repository
git clone https://github.com/your-org/boletera-app.git
cd boletera-app

# Install workspace dependencies
pnpm install

# Install workspace packages
pnpm install -r

# Verify monorepo structure
pnpm ls --depth=0
```

---

## ⚙️ ENVIRONMENT CONFIGURATION

### **1. API Server (.env)**

```bash
cd apps/api
cp .env.example .env
```

**Edit `apps/api/.env`:**

```env
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/boletera"

# Redis
REDIS_URL="redis://localhost:6379/0"

# JWT
JWT_SECRET="your-super-secret-key-min-32-chars"
JWT_EXPIRY="7d"

# Payment Gateways
STRIPE_SECRET_KEY="sk_test_..."
BANORTE_API_KEY="..."
BANORTE_SECRET="..."

# Email/Notifications
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="your-app-password"

# Webhooks
WEBHOOK_SECRET="webhook-secret-key"

# Server
PORT=3000
NODE_ENV=development
```

### **2. Admin Dashboard (.env.local)**

```bash
cd apps/admin
cp .env.example .env.local
```

**Edit `apps/admin/.env.local`:**

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_AUTH_TOKEN_KEY=boletera_token
NEXT_PUBLIC_APP_NAME=BOLETERA Admin
```

### **3. Web App (.env.local)**

```bash
cd apps/web
cp .env.example .env.local
```

**Edit `apps/web/.env.local`:**

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_AUTH_TOKEN_KEY=boletera_token
NEXT_PUBLIC_APP_NAME=BOLETERA
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=pk_test_...
```

---

## 🗄️ DATABASE SETUP

### **1. Create Database**

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE boletera;
CREATE USER boletera_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE boletera TO boletera_user;
\q
```

### **2. Apply Migrations**

```bash
cd packages/database

# Create migration
pnpm prisma migrate dev --name init

# Seed database (optional)
pnpm prisma db seed

# Open Prisma Studio (interactive DB browser)
pnpm prisma studio
```

### **3. Verify Schema**

```bash
pnpm prisma db push --skip-generate --dry-run
```

---

## 🚀 START DEVELOPMENT SERVERS

### **Terminal 1: Backend API**

```bash
cd apps/api
pnpm dev

# Expected output:
# [Nest] 12345 - 05/17/2026, 10:00:00 AM     LOG [NestFactory] Nest application successfully started +123ms
# ✓ Server running on http://localhost:3000
```

### **Terminal 2: Admin Dashboard**

```bash
cd apps/admin
pnpm dev

# Expected output:
# ▲ Next.js 14.1.3
# - Local:        http://localhost:3001
# - Environments: .env.local
```

### **Terminal 3: Web App**

```bash
cd apps/web
pnpm dev

# Expected output:
# ▲ Next.js 14.1.3
# - Local:        http://localhost:3002
# - Environments: .env.local
```

### **Terminal 4: Worker (Background Jobs)**

```bash
cd apps/worker
pnpm dev
```

---

## ✅ VERIFY SETUP

### **1. Backend Health Check**

```bash
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"2026-05-17T10:00:00Z"}
```

### **2. Admin Dashboard Login**

1. Open http://localhost:3001
2. Login with demo credentials:
   - **Email:** admin@boletera.com
   - **Password:** demo123

3. Should see dashboard with KPIs

### **3. Web App Home**

1. Open http://localhost:3002
2. Should see event discovery page
3. Click on an event → see seat selection

### **4. Database Verification**

```bash
cd packages/database
pnpm prisma studio
# Opens http://localhost:5555
# Browse all tables and data
```

---

## 📁 PROJECT STRUCTURE REFERENCE

```
boletera-app/
├── apps/
│   ├── api/                    # NestJS Backend (port 3000)
│   │   ├── src/
│   │   │   ├── app.module.ts   # All 7 modules registered
│   │   │   ├── modules/        # 7 feature modules
│   │   │   └── [...]
│   │   ├── .env                # Backend config
│   │   └── package.json
│   │
│   ├── admin/                  # Next.js Admin (port 3001)
│   │   ├── app/
│   │   │   ├── (platform)/     # Admin routes
│   │   │   ├── login/          # Auth page
│   │   │   └── page.tsx
│   │   ├── components/         # Reusable UI components
│   │   ├── .env.local          # Admin config
│   │   └── package.json
│   │
│   ├── web/                    # Next.js Web App (port 3002)
│   │   ├── app/
│   │   │   ├── page.tsx        # Home - Event Discovery
│   │   │   ├── event/[id]/     # Event details
│   │   │   └── [...]
│   │   ├── components/         # Customer UI components
│   │   ├── .env.local          # Web config
│   │   └── package.json
│   │
│   ├── taquilla/               # POS Terminal App
│   ├── worker/                 # Background Jobs
│   └── [...]
│
├── packages/
│   ├── ui/                     # Shared utilities
│   │   ├── api-client.ts       # HTTP client (350 LOC)
│   │   ├── hooks.ts            # React hooks (500 LOC)
│   │   ├── types.ts            # TypeScript types
│   │   └── [...]
│   ├── database/
│   │   └── prisma/
│   │       ├── schema.prisma   # DB schema
│   │       └── migrations/
│   └── [...]
│
├── docs/                       # Documentation
├── .env.example                # Template env vars
├── pnpm-workspace.yaml         # Monorepo config
├── turbo.json                  # Build system
└── package.json                # Root package.json
```

---

## 🔨 COMMON DEVELOPMENT TASKS

### **Add New NPM Package**

```bash
# In specific workspace
cd apps/admin
pnpm add react-hook-form

# In all workspaces
pnpm add -r some-package

# In root only
pnpm add -w turbo
```

### **Run Tests**

```bash
# Backend tests
cd apps/api
pnpm test

# Admin tests
cd apps/admin
pnpm test
```

### **Type Check**

```bash
# All workspaces
pnpm -r type-check

# Or individually
cd apps/api && pnpm tsc --noEmit
```

### **Format Code**

```bash
# All files
pnpm format

# Watch mode
pnpm format:watch
```

### **Linting**

```bash
# All workspaces
pnpm -r lint

# Fix issues automatically
pnpm -r lint:fix
```

---

## 🐛 DEBUGGING

### **VS Code Debug Configuration**

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "attach",
      "name": "Attach API",
      "port": 9229,
      "restart": true,
      "protocol": "inspector"
    },
    {
      "type": "chrome",
      "request": "launch",
      "name": "Admin Dashboard",
      "url": "http://localhost:3001",
      "webRoot": "${workspaceFolder}/apps/admin"
    }
  ]
}
```

### **Enable Debug Logging**

```bash
# Backend with debug output
DEBUG=* pnpm dev

# Or per module
DEBUG=boletera:* pnpm dev
```

### **Database Logs**

```bash
# View recent migrations
cd packages/database
pnpm prisma migrate status

# Rollback last migration
pnpm prisma migrate resolve --rolled-back [migration_name]
```

---

## 📊 MONITORING & LOGS

### **Backend Logs**

```bash
# Real-time logs
tail -f logs/api.log

# Last 100 lines with errors
grep ERROR logs/api.log | tail -100
```

### **Redis Monitoring**

```bash
redis-cli monitor
# Shows all Redis commands in real-time
```

### **Database Connections**

```bash
psql -U postgres -d boletera

# List active connections
SELECT datname, usename, state FROM pg_stat_activity;

# Kill slow queries
SELECT pg_terminate_backend(pid) WHERE query_start < now() - interval '1 minute';
```

---

## 🚀 NEXT STEPS

1. **Explore the codebase:**
   - Read the repo [README](../README.md)
   - Review [FRONTEND_IMPLEMENTATION.md](./FRONTEND_IMPLEMENTATION.md)
   - Study [API_REFERENCE.md](./API_REFERENCE.md)

2. **Try the API:**
   - Import Postman collection from `docs/BOLETERA-API.postman_collection.json`
   - Create your first event
   - Track real-time metrics in dashboard

3. **Contribute:**
   - Create feature branch: `git checkout -b feature/your-feature`
   - Make changes and test
   - Commit with conventional commits: `git commit -m "feat: add new feature"`
   - Push and create pull request

---

## 🆘 TROUBLESHOOTING

### **Port Already in Use**

```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 [PID]
```

### **Database Connection Failed**

```bash
# Verify PostgreSQL is running
pg_isready -h localhost -p 5432

# Check connection string
echo $DATABASE_URL
```

### **Redis Connection Error**

```bash
# Test Redis connection
redis-cli ping

# Check Redis status
redis-cli info server
```

### **Module Not Found Errors**

```bash
# Clear cache and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Rebuild TypeScript
pnpm -r build
```

---

## 📞 SUPPORT

- **Issues:** Check GitHub issues or Slack
- **Docs:** See `docs/` folder
- **API:** Postman collection in `docs/`
- **Questions:** Open discussion in GitHub

---

**Happy developing!** 🎉
