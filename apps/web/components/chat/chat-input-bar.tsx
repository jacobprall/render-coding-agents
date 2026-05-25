"use client";

import { ChatInput } from "../session/chat-input";
import { useChatContext } from "./chat-context";

function ChatInputBar() {
  const {
    isStreaming,
    modelId,
    activeSkills,
    onModelChange,
    sendMessage,
    stopStreaming,
  } = useChatContext();

  return (
    <ChatInput
      isStreaming={isStreaming}
      modelId={modelId}
      activeSkills={activeSkills}
      onModelChange={onModelChange}
      onSend={(content, turnSkillRefs) => void sendMessage(content, turnSkillRefs)}
      onStop={() => void stopStreaming()}
    />
  );
}
ChatInputBar.displayName = "Chat.Input";

export { ChatInputBar };
