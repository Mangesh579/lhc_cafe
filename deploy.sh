#!/bin/bash
set -e

echo "📥 Pulling latest code..."
cd /mnt/e/lhc_cafe
git pull

echo "📦 Installing dependencies..."
pnpm install

echo "🔨 Building backend..."
cd artifacts/api-server
pnpm build

echo "🔄 Restarting server..."
pm2 restart cafe-nexus-api

echo "✅ Deploy complete. Checking health..."
sleep 2
curl -s http://localhost:3000/api/healthz
echo ""
