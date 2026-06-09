---
name: Hook calling convention
description: Orval-generated hooks take API params as first arg, not wrapped in {query:{...}}. React Query v5 requires explicit queryKey in options.
---

## Rule
Generated hooks from Orval follow this signature:
```ts
useListSomething(params?: SomethingParams, options?: { query?: UseQueryOptions<...>, request?: ... })
```

**Correct:**
```ts
useListOrders({ date: "2024-01-01", status: "completed" })
useListMenuItems({ available: true })
useListLoyaltyCustomers({ phone: "98xxxxxxxx" })
useGetMenuItem(id, { query: { queryKey: getGetMenuItemQueryKey(id), enabled: !!id } })
```

**Wrong (causes TS errors):**
```ts
useListOrders({ query: { date: "2024-01-01" } })  // 'query' not in ListOrdersParams
useGetMenuItem(id, { query: { enabled: true } })   // missing 'queryKey'
```

## Why
Orval generates params as the first positional argument, not nested. React Query v5 made `queryKey` required in `UseQueryOptions`. Each hook has a `get<HookName>QueryKey(id)` helper that returns the correct key.

## How to apply
- Always pass API query params as first arg directly
- When passing `options.query` with `enabled`, include `queryKey: get<Name>QueryKey(id)`
- The `options.query` slot is for React Query configuration, not API params
