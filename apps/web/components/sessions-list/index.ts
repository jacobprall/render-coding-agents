import { SessionsListRoot } from "./sessions-list-root";
import { SessionsListSearch } from "./sessions-list-search";
import { SessionsListFilter } from "./sessions-list-filter";
import { SessionsListGroups } from "./sessions-list-groups";
import { SessionsListItem } from "./sessions-list-item";
import { SessionsListEmpty } from "./sessions-list-empty";

interface SessionsListComponent {
  Root: typeof SessionsListRoot;
  Search: typeof SessionsListSearch;
  Filter: typeof SessionsListFilter;
  Groups: typeof SessionsListGroups;
  Item: typeof SessionsListItem;
  Empty: typeof SessionsListEmpty;
}

export const SessionsList: SessionsListComponent = {
  Root: SessionsListRoot,
  Search: SessionsListSearch,
  Filter: SessionsListFilter,
  Groups: SessionsListGroups,
  Item: SessionsListItem,
  Empty: SessionsListEmpty,
} as const;

export { useSessionsListState, useSessionsListConfig } from "./sessions-list-context";
export type {
  SessionItem,
  SessionGroup,
  SessionFilter,
} from "./sessions-list-context";
export { STATUS_DOT, repoSlug, formatRelativeTime } from "./sessions-list-utils";
