---
name: Refactor
description: Code smell to refactoring cross-reference based on Fowler's Refactoring (2nd ed) catalog.
---

# Code Smell → Refactoring Map

Catalog reference: https://refactoring.com/catalog/

Use this table to identify which refactoring to reach for when you spot a smell. Multiple refactorings may apply — start with the first listed.

| Code Smell / Trigger | Refactoring(s) to Apply |
|---|---|
| **Long Function** — function does too many things or is hard to name | Extract Function, Replace Temp with Query, Decompose Conditional, Replace Function with Command |
| **Large Class** — class has too many fields, methods, or responsibilities | Extract Class, Extract Superclass, Replace Primitive with Object |
| **Long Parameter List** — function takes many arguments | Introduce Parameter Object, Preserve Whole Object, Replace Parameter with Query, Remove Flag Argument |
| **Duplicated Code** — same or very similar logic in multiple places | Extract Function, Slide Statements, Move Statements into Function, Replace Inline Code with Function Call |
| **Divergent Change** — one class is modified for multiple unrelated reasons | Extract Class, Move Function, Move Field |
| **Shotgun Surgery** — a single change requires edits across many classes | Move Function, Move Field, Inline Function, Inline Class, Combine Functions into Class |
| **Feature Envy** — a method uses more data from another class than its own | Move Function, Move Field, Extract Function |
| **Data Clumps** — the same group of fields/params appears together repeatedly | Introduce Parameter Object, Extract Class, Preserve Whole Object |
| **Primitive Obsession** — using raw strings/numbers instead of small domain objects | Replace Primitive with Object, Replace Type Code with Subclasses, Replace Conditional with Polymorphism |
| **Switch/If Chains on Type** — repeated conditional logic branching on a type code | Replace Conditional with Polymorphism, Replace Type Code with Subclasses, Introduce Special Case |
| **Speculative Generality** — unused abstractions, hooks, or parameters "just in case" | Collapse Hierarchy, Inline Function, Inline Class, Remove Dead Code, Change Function Declaration |
| **Dead Code** — unreachable code, unused variables, or obsolete branches | Remove Dead Code |
| **Temporary Field** — field only set/used in certain code paths | Extract Class, Introduce Special Case, Move Function |
| **Message Chains** — long chains of `a.getB().getC().getD()` | Hide Delegate, Extract Function, Move Function |
| **Middle Man** — class delegates almost everything to another class | Remove Middle Man, Inline Function, Replace Superclass with Delegate |
| **Inappropriate Intimacy** — classes access each other's internals excessively | Move Function, Move Field, Hide Delegate, Extract Class, Replace Superclass with Delegate |
| **Refused Bequest** — subclass inherits but ignores or overrides most parent behavior | Replace Superclass with Delegate, Push Down Method, Push Down Field |
| **Comments compensating for bad code** — comments explain *what* the code does rather than *why* | Extract Function, Rename Variable, Introduce Assertion, Extract Variable |
| **Mutable shared state** — variables reassigned across scopes making flow hard to follow | Split Variable, Replace Derived Variable with Query, Return Modified Value, Separate Query from Modifier |
| **Nested conditionals / arrow code** — deeply nested `if/else` blocks | Replace Nested Conditional with Guard Clauses, Decompose Conditional, Consolidate Conditional Expression |
| **Magic literals** — unexplained numbers or strings scattered through code | Replace Magic Literal |
| **Inconsistent naming** — same concept has different names in different places | Rename Variable, Rename Field, Change Function Declaration |
| **God constructor** — constructor does real work (I/O, complex logic) beyond assignment | Extract Function, Replace Constructor with Factory Function, Move Statements to Callers |
| **Loop doing too much** — a single loop accumulates multiple results | Split Loop, Replace Loop with Pipeline, Extract Function |
| **Error codes instead of exceptions** — returning status codes forces callers to check manually | Replace Error Code with Exception |
| **Exception as control flow** — using try/catch for expected conditions | Replace Exception with Precheck |
| **Parallel inheritance hierarchies** — adding a subclass in one hierarchy requires adding one in another | Move Function, Move Field, Replace Subclass with Delegate |
| **Encapsulation breach** — exposing raw collections or records | Encapsulate Collection, Encapsulate Record, Encapsulate Variable |

### Quick-Reference: When to Inline vs. Extract

| Situation | Direction |
|---|---|
| Indirection adds no value; wrapper just delegates | **Inline** (Inline Function, Inline Class, Remove Middle Man) |
| Logic is reused, or a name would clarify intent | **Extract** (Extract Function, Extract Class, Extract Variable) |
| Abstraction was speculative and never materialized | **Inline** then reassess |
