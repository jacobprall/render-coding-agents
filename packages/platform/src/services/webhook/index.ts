import type { PlatformDb } from "../../interfaces/database";
import type { QueueAdapter } from "../../interfaces/queue";
import type { EventBus } from "../../interfaces/events";
import type { CIService } from "../ci";
import { GitHubWebhookHandler } from "./github-handler";

export class WebhookService {
  private github: GitHubWebhookHandler;

  constructor(
    db: PlatformDb,
    queue: QueueAdapter,
    events: EventBus,
    ciService: CIService,
  ) {
    const deps = { db, queue, events, ciService };
    this.github = new GitHubWebhookHandler(deps);
  }

  handleGithubWebhook(rawBody: string, signature: string | null) {
    return this.github.handleGithubWebhook(rawBody, signature);
  }

  handleGithubEvent(event: string | null, rawBody: string) {
    return this.github.handleGithubEvent(event, rawBody);
  }
}
