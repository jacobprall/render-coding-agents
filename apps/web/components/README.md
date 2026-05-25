# Component Conventions

## Design system

**`@/components/ui/`** (shadcn/ui) is the canonical design system. All new components
import atoms from here. All design-system primitives now live in `ui/`.

Token reference: [`globals.css`](../app/globals.css) — use `primary`, `muted`,
`foreground`, `border`, etc. Legacy `surface-*` / `text-*` aliases exist for
migration but should not be used in new code.

## Compound component pattern

Domain UI (sessions list, chat, file browser) uses the compound component
pattern. Follow this contract for every compound:

### File structure

```
components/<domain>/
  index.ts                 # re-export the compound object
  <domain>-root.tsx        # provider: data + local state + context
  <domain>-context.tsx     # context types + useXContext() hook
  <domain>-<subpart>.tsx   # one file per subpart
```

### Rules

1. **`Component.Root`** owns data fetching (SWR) and shared UI state
   (`useState`). Children never fetch on their own.

2. **Split contexts** when performance matters — separate `ConfigContext`
   (variant, filter — rarely changes) from `StateContext` (selection, query —
   changes on interaction).

3. **`useXContext()` hook** — throws if called outside Root:
   ```tsx
   export function useSessionsListContext() {
     const ctx = useContext(SessionsListStateContext);
     if (!ctx) throw new Error("Must be used within SessionsList.Root");
     return ctx;
   }
   ```

4. **`displayName`** on every subpart: `SearchInput.displayName = "SessionsList.Search"`.

5. **Export a typed object**:
   ```tsx
   interface SessionsListComponent {
     Root: React.ComponentType<RootProps>;
     Search: React.ComponentType<SearchProps>;
     // ...
   }

   export const SessionsList: SessionsListComponent = {
     Root,
     Search,
     // ...
   } as const;
   ```

6. **Local state in Root** — collapse, expand, dismiss, search query all live
   in Root's `useState`, never in a global store.

7. **No fetch in leaf subparts** — data flows Root → context → leaves.

### Example usage

```tsx
<SessionsList.Root filter="active">
  <SessionsList.Toolbar>
    <SessionsList.Search />
    <SessionsList.Filter />
  </SessionsList.Toolbar>
  <SessionsList.Groups />
</SessionsList.Root>
```

### Testing

- Assert context guard throws outside Root.
- Assert shared state propagates (toggle filter → groups update).
- Test subparts in isolation by wrapping in Root with mock data.
