---
name: Implement
description: SOLID principles, interface segregation, dependency injection, requirement decomposition, and 10 essential design patterns (Strategy, Adapter, Factory, Observer, Decorator, Builder, Repository, Middleware, Facade, Command).
---

# Implementation Guidelines

## SOLID Principles

### Single Responsibility (SRP)
A class/module should have one reason to change. If you can describe what it does with "and", split it.

### Open/Closed (OCP)
Extend behavior through composition or polymorphism, not by modifying existing code. Use strategy objects, plugins, or event hooks instead of adding `if/else` branches.

### Liskov Substitution (LSP)
Subtypes must be substitutable for their base types without breaking callers. Don't override methods to throw `NotImplemented` or silently no-op — that violates the contract.

### Interface Segregation (ISP)
Clients should not depend on methods they don't use. Prefer small, focused interfaces over fat ones.

```typescript
// ❌ Fat interface — forces implementors to stub methods they don't need
interface Repository {
  find(id: string): Entity;
  findAll(): Entity[];
  save(entity: Entity): void;
  delete(id: string): void;
  bulkImport(entities: Entity[]): void;
  generateReport(): Report;
}

// ✅ Segregated — compose only what you need
interface Readable<T>    { find(id: string): T; findAll(): T[]; }
interface Writable<T>    { save(entity: T): void; delete(id: string): void; }
interface BulkOps<T>     { bulkImport(entities: T[]): void; }
interface Reportable     { generateReport(): Report; }

// A service that only reads doesn't carry write baggage
class DashboardService {
  constructor(private repo: Readable<User> & Reportable) {}
}
```

### Dependency Inversion (DIP)
High-level modules depend on abstractions, not concrete implementations. Abstractions should not depend on details.

---

## Dependency Injection & Inversion

### When to use DI
- The dependency has side effects (network, disk, clock, randomness).
- You need to swap implementations (e.g., in-memory store for tests, S3 for prod).
- The dependency's lifecycle differs from its consumer (singleton service vs. per-request handler).
- Multiple consumers share a dependency and you want a single configuration point.

### When DI is overkill
- Pure utility functions with no side effects (`slugify`, `clamp`, `deepMerge`).
- Module-level constants or enums.
- When there is only one possible implementation and no testability concern.

### Practical pattern

```typescript
// Define the abstraction
interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

// Inject via constructor
class OrderService {
  constructor(private emailSender: EmailSender) {}

  async placeOrder(order: Order) {
    await this.persist(order);
    await this.emailSender.send(order.customerEmail, "Confirmation", "...");
  }
}

// Wire at composition root — not scattered through business logic
const emailSender = isTest ? new FakeEmailSender() : new SesEmailSender(config);
const orderService = new OrderService(emailSender);
```

---

## Decomposing Complex or Ambiguous Requirements

1. **Identify nouns and verbs.** Nouns become entities/types; verbs become operations/services.
2. **Separate what from how.** Define the public contract (types, interfaces, function signatures) before writing implementation.
3. **Slice vertically.** Implement one thin end-to-end path first (API → logic → persistence) rather than building entire layers horizontally.
4. **Name the unknowns.** If a requirement is vague, introduce a named abstraction with a TODO. A placeholder interface is better than a guess baked into concrete code.
5. **Timebox spikes.** For genuinely unclear areas, write a short throwaway prototype bounded by time, then extract what you learned into the real design.
6. **Establish invariants early.** Write down what must always be true (e.g., "an order always has at least one line item"). These become assertions, validations, and tests.

---

## 10 Essential Design Patterns

### 1. Strategy
Encapsulate a family of interchangeable algorithms behind a common interface.

**Use when:** behavior varies by context and you want to avoid conditional branches.
**Skip when:** there's only one algorithm and no foreseeable variation.

### 2. Adapter
Wrap an incompatible interface so it conforms to the one your code expects.

**Use when:** integrating third-party libraries or legacy code with a different API shape.
**Skip when:** you control both sides and can just change the interface directly.

### 3. Factory (Factory Method / Abstract Factory)
Centralize object creation so callers don't depend on concrete classes.

**Use when:** construction logic is non-trivial, or the concrete type depends on runtime config.
**Skip when:** a simple constructor call is clear and sufficient.

### 4. Observer / Event Emitter
Let objects subscribe to events without the publisher knowing about subscribers.

**Use when:** multiple independent reactions to a state change; decoupling producers from consumers.
**Skip when:** there's exactly one consumer — a direct call is simpler and easier to trace.

### 5. Decorator
Wrap an object to transparently add behavior (logging, caching, retries) without modifying the original.

**Use when:** you need to compose cross-cutting concerns around existing logic.
**Skip when:** the behavior is intrinsic to the object and will never be toggled or recomposed.

### 6. Builder
Construct complex objects step-by-step with a fluent API, separating construction from representation.

**Use when:** objects have many optional parameters or require validation before creation.
**Skip when:** a plain object literal or a constructor with a few args is readable enough.

### 7. Repository
Mediate between domain logic and data mapping, exposing a collection-like interface for persistence.

**Use when:** you want domain code free of SQL/ORM/API details and easy to test with in-memory fakes.
**Skip when:** the project is a simple script or CRUD with no domain logic worth isolating.

### 8. Middleware / Chain of Responsibility
Pass a request through a chain of handlers, each deciding to process, transform, or forward.

**Use when:** request processing involves ordered, composable steps (auth → validation → logging → handler).
**Skip when:** processing is a single step with no foreseeable extension points.

### 9. Facade
Provide a simplified interface to a complex subsystem.

**Use when:** callers need a high-level API and shouldn't know about internal wiring.
**Skip when:** the subsystem is already simple — a facade adds indirection for no benefit.

### 10. Command
Encapsulate a request as an object, enabling undo, queuing, logging, or deferred execution.

**Use when:** you need to record, replay, or undo operations; or dispatch work to a queue.
**Skip when:** operations are fire-and-forget with no need for history or deferred execution.
