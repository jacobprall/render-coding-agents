import { ChatRoot } from "./chat-root";
import { ChatMessages } from "./chat-messages";
import { ChatInputBar } from "./chat-input-bar";

interface ChatComponent {
  Root: typeof ChatRoot;
  Messages: typeof ChatMessages;
  Input: typeof ChatInputBar;
}

export const Chat: ChatComponent = {
  Root: ChatRoot,
  Messages: ChatMessages,
  Input: ChatInputBar,
} as const;

export { useChatContext } from "./chat-context";
export type { ChatContextValue } from "./chat-context";
