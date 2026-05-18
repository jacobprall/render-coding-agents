import type { InboundEvent, InboundRoute, RouteAction } from "./types";

// ---------------------------------------------------------------------------
// InboundRouter — first-match-wins evaluation of InboundRoute[]
// ---------------------------------------------------------------------------

export class InboundRouter {
  constructor(private readonly routes: InboundRoute[]) {}

  evaluate(event: InboundEvent): RouteAction {
    for (const route of this.routes) {
      if (route.match(event)) {
        const action = route.handle(event);
        console.info("[inbound.routed]", {
          eventId: event.id,
          source: event.source,
          kind: event.kind,
          route: route.name,
          action: action.type,
        });
        return action;
      }
    }

    console.info("[inbound.ignored]", {
      eventId: event.id,
      source: event.source,
      kind: event.kind,
    });

    return { type: "ignore", reason: "no matching route" };
  }
}
