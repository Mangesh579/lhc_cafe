# LHC Cafe Management System

A full-stack cafe management system covering POS, digital menu, inventory tracking, table QR ordering, loyalty rewards, and admin/staff roles. Built for a Nepal cafe context.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/lhc-cafe run dev` — run the frontend (port 18096, proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — JWT signing secret

## Default Credentials

- **Admin**: `admin` / `admin123`
- **Staff**: `staff1` / `staff123`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + JWT auth (bcryptjs + jsonwebtoken)
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite + Wouter + React Query + shadcn/ui + Recharts
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — DB schema (users, menu, inventory, orders, tables, loyalty)
- `lib/api-spec/openapi.yaml` — OpenAPI source of truth
- `lib/api-client-react/src/generated/` — generated hooks + Zod schemas (do not edit)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/auth.ts` — JWT sign/verify helpers
- `artifacts/api-server/src/middlewares/auth.ts` — authenticate + requireAdmin middleware
- `artifacts/lhc-cafe/src/pages/` — all frontend pages
- `artifacts/lhc-cafe/src/contexts/auth.tsx` — AuthContext with JWT token management

## Architecture decisions

- JWT stored in `localStorage` key `lhc_token`; custom-fetch injects it as `Authorization: Bearer` on every request
- All numeric DB columns stored as Drizzle `numeric` (string); parse with `parseFloat` on the backend
- Inventory deduction happens at order creation time (both POS and public QR orders)
- Loyalty points: 1 point per Rs 10 spent (floor); awarded when payment status → "paid"
- Public customer ordering uses table NUMBER (not table DB id) in the URL: `/order/:tableNumber`
- Payment methods: Cash and Nabil QR only (static placeholder QR image)
- 20 tables pre-seeded, expandable from Admin → Tables page

## Product

- **POS**: Staff/admin take orders, search loyalty customers, select Cash or Nabil QR payment, print receipts
- **Active Orders**: View/update order status (pending → preparing → ready → completed), process payment
- **Order Log**: Historical orders with filters by date, status, payment method
- **Menu Management**: Add/edit/delete items, toggle availability, manage ingredients per item
- **Inventory**: Track stock levels, low-stock warnings, manual stock adjustments with audit log
- **Tables**: View QR codes for all 20 tables, download QR for printing, add/remove tables
- **Loyalty**: Register customers by name + phone, view point balances and spending history
- **Dashboard**: Today's sales, weekly trend chart, top-selling items, pending orders count
- **Public QR**: Customers scan table QR → browse menu → place order → staff notified in Active Orders

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI spec change before editing frontend
- Never use deep imports from `@workspace/api-client-react/src/generated/*` — all types re-export from the package root
- All amounts displayed as Rs. (Nepali Rupees)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
