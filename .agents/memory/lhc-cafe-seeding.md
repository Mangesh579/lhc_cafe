---
name: LHC Cafe DB seeding
description: How to generate bcrypt hashes and seed users for LHC Cafe
---

The `code_execution` sandbox does not have bcryptjs available. To generate bcrypt hashes for seeding, use the api-server's installed module:

```bash
node -e "
const bcrypt = require('./artifacts/api-server/node_modules/bcryptjs');
console.log(bcrypt.hashSync('admin123', 10));
"
```

**Why:** The sandbox runs from the workspace root where bcryptjs is not installed at root level — only in artifacts/api-server/node_modules.

**Current seed:** admin/admin123, staff1/staff123. Update via SQL: `UPDATE users SET password_hash = '<hash>' WHERE username = 'admin'`.
