"use client";

export function AskUserCard({
  ask,
  onRespond,
}: {
  ask: { question?: string; options?: string[] };
  onRespond: (answer: string) => void;
}) {
  const question = "question" in ask ? (ask as { question: string }).question : "";
  const options = "options" in ask ? ((ask as { options?: string[] }).options ?? []) : [];

  return (
    <div className="border border-warning/20 bg-warning/5 p-(--of-space-md)">
      <p className="mb-1 text-xs font-medium text-warning/70">Agent needs your input</p>
      <p className="mb-3 text-[15px] text-warning">{question}</p>
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {options.map((opt: string) => (
            <button
              key={opt}
              type="button"
              onClick={() => onRespond(opt)}
              className="border border-warning/30 bg-warning/10 px-3 py-1.5 text-sm font-medium text-warning transition-colors duration-(--of-duration-instant) hover:bg-warning/20"
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const answer = formData.get("answer") as string;
            if (answer?.trim()) onRespond(answer);
          }}
          className="flex gap-2"
        >
          <input
            name="answer"
            className="flex-1 border border-warning/30 bg-surface-1 px-3 py-1.5 text-sm text-text-primary outline-none focus:border-warning"
            placeholder="Type your answer…"
          />
          <button
            type="submit"
            className="bg-warning px-3 py-1.5 text-sm font-medium text-surface-0 transition-colors duration-(--of-duration-instant) hover:bg-warning/70"
          >
            Reply
          </button>
        </form>
      )}
    </div>
  );
}
