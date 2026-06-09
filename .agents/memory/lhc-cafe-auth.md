---
name: LHC Cafe auth setup
description: JWT auth pattern for LHC Cafe — token storage, injection, and import conventions
---

JWT stored in localStorage key `lhc_token`. The custom-fetch at `lib/api-client-react/src/custom-fetch.ts` already reads this key and injects `Authorization: Bearer <token>` on every request automatically — no extra setup needed.

**Why:** The api-client-react package only exports from its root (`.`→`./src/index.ts`). All generated types (`UserRole`, `LoginInput`, `User`, `MenuItem`, `OrderStatusUpdateStatus`, etc.) re-export from the package root.

**How to apply:** Always import types as `import { Foo } from "@workspace/api-client-react"`, never as `@workspace/api-client-react/src/generated/api.schemas`. The latter is not an exported subpath and Vite will error.
