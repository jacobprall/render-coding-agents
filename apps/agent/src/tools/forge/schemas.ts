import { z } from "zod";

export const prNumberSchema = z.number().int().positive().describe("Pull request number");
