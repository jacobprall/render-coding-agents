import { defineTool } from "./define-tool";
import { z } from "zod";

const todoWriteInputSchema = z.object({
  todos: z.array(z.object({
    id: z.string(),
    content: z.string(),
    status: z.enum(["pending", "in_progress", "completed"]),
  })),
  merge: z.boolean().describe("If true, merge with existing todos. If false, replace."),
});

type Todo = { id: string; content: string; status: "pending" | "in_progress" | "completed" };

export class TodoStore {
  private items: Todo[] = [];

  merge(incoming: Todo[]): void {
    for (const todo of incoming) {
      const idx = this.items.findIndex((t) => t.id === todo.id);
      if (idx >= 0) {
        this.items[idx] = { ...this.items[idx]!, ...todo };
      } else {
        this.items.push(todo);
      }
    }
  }

  replace(incoming: Todo[]): void {
    this.items = [...incoming];
  }

  getAll(): Todo[] {
    return [...this.items];
  }
}

export function todoWriteTool(store = new TodoStore()) {
  return defineTool({
    description: "Manage a structured task list for the current session.",
    inputSchema: todoWriteInputSchema,
    execute: async ({ todos: incoming, merge }) => {
      if (merge) {
        store.merge(incoming);
      } else {
        store.replace(incoming);
      }
      return { todos: store.getAll() };
    },
  });
}
