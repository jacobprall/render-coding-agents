"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { GitBranch, ChevronDown, Search, Plus } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/api-fetch";

interface Repo {
  id: number | string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate?: boolean;
}

interface Branch {
  name: string;
}

interface RepoBranchPickerProps {
  value: { repo: string; branch: string } | null;
  onChange: (value: { repo: string; branch: string }) => void;
  initialRepos?: Repo[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function RepoBranchPicker({ value, onChange, initialRepos }: RepoBranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"repo" | "branch">("repo");
  const [query, setQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchError, setBranchError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const newBranchRef = useRef<HTMLInputElement>(null);
  const { mutate } = useSWRConfig();

  const reposFallback = initialRepos?.length ? { repos: initialRepos } : undefined;
  const { data: reposData, isLoading: reposLoading } = useSWR<{ repos: Repo[] }>(
    "/api/sessions/repos",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000, fallbackData: reposFallback },
  );
  const repos = reposData?.repos ?? [];

  const branchPath = selectedRepo
    ? `/api/sessions/repos/${selectedRepo.fullName}/branches`
    : null;
  const { data: branchesData, isLoading: branchesLoading } = useSWR<{ branches: Branch[] }>(
    branchPath,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const branches = branchesData?.branches ?? [];

  const filteredRepos = query
    ? repos.filter(
        (r) =>
          r.name.toLowerCase().includes(query.toLowerCase()) ||
          r.fullName.toLowerCase().includes(query.toLowerCase()),
      )
    : repos;

  const filteredBranches = query
    ? branches.filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
    : branches;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreatingBranch(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && !creatingBranch && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open, step, creatingBranch]);

  useEffect(() => {
    if (creatingBranch && newBranchRef.current) {
      newBranchRef.current.focus();
    }
  }, [creatingBranch]);

  const handleRepoSelect = useCallback(
    (repo: Repo) => {
      setSelectedRepo(repo);
      setQuery("");
      setStep("branch");
      onChange({ repo: repo.fullName, branch: repo.defaultBranch });
    },
    [onChange],
  );

  const handleBranchSelect = useCallback(
    (branch: string) => {
      if (selectedRepo) {
        onChange({ repo: selectedRepo.fullName, branch });
      }
      setOpen(false);
      setQuery("");
    },
    [selectedRepo, onChange],
  );

  const handleCreateBranch = useCallback(async () => {
    if (!selectedRepo || !newBranchName.trim()) return;
    setBranchError(null);

    try {
      const { ok, data } = await apiFetch<{ error?: string }>(
        `/api/sessions/repos/${selectedRepo.fullName}/branches`,
        {
          method: "POST",
          body: {
            name: newBranchName.trim(),
            from: value?.branch || selectedRepo.defaultBranch,
          },
        },
      );

      if (!ok) {
        setBranchError(data.error || "Failed to create branch");
        return;
      }

      // Revalidate the branches list and select the new branch
      await mutate(branchPath);
      onChange({ repo: selectedRepo.fullName, branch: newBranchName.trim() });
      setCreatingBranch(false);
      setNewBranchName("");
      setOpen(false);
    } catch {
      setBranchError("Network error");
    }
  }, [selectedRepo, newBranchName, value, branchPath, mutate, onChange]);

  const handleOpen = useCallback(() => {
    setOpen(true);
    setStep(value?.repo ? "branch" : "repo");
    setQuery("");
    setCreatingBranch(false);
    if (value?.repo) {
      const match = repos.find((r) => r.fullName === value.repo);
      if (match) setSelectedRepo(match);
    }
  }, [value, repos]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex min-h-10 items-center gap-1.5 border border-stroke-subtle bg-surface-1 px-3 py-2 text-[13px] text-text-secondary transition-colors duration-(--of-duration-instant) hover:bg-surface-2 hover:text-text-primary"
      >
        <GitBranch className="h-3 w-3 shrink-0 text-text-tertiary" />
        {value ? (
          <span className="truncate max-w-[200px] font-mono">
            {value.repo} <span className="text-text-tertiary">:</span> {value.branch}
          </span>
        ) : (
          <span className="text-text-tertiary">Select repo</span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-text-tertiary" />
      </button>

      {open && (
        <div className="absolute left-0 bottom-full z-50 mb-1 w-80 max-w-[calc(100vw-2rem)] border border-stroke-subtle bg-surface-1 shadow-lg">
          <div className="flex items-center gap-2 border-b border-stroke-subtle px-(--of-space-sm) py-(--of-space-xs)">
            <Search className="h-3 w-3 text-text-tertiary shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={step === "repo" ? "Search repositories…" : "Search branches…"}
              className="flex-1 bg-transparent text-[13px] text-text-primary placeholder-text-tertiary outline-none"
            />
            {step === "branch" && selectedRepo && (
              <button
                type="button"
                onClick={() => {
                  setCreatingBranch(true);
                  setNewBranchName("");
                  setBranchError(null);
                }}
                className="inline-flex items-center gap-1 text-[11px] text-accent-text transition-colors duration-(--of-duration-instant) hover:text-text-primary"
              >
                <Plus className="h-3 w-3" />
                New branch
              </button>
            )}
          </div>

          {creatingBranch && selectedRepo && (
            <div className="border-b border-stroke-subtle px-(--of-space-sm) py-2">
              <div className="flex items-center gap-1.5">
                <input
                  ref={newBranchRef}
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateBranch();
                    }
                    if (e.key === "Escape") setCreatingBranch(false);
                  }}
                  placeholder="new-branch-name"
                  className="flex-1 border border-stroke-default bg-surface-2 px-2 py-1 text-[13px] font-mono text-text-primary placeholder-text-tertiary outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateBranch()}
                  disabled={!newBranchName.trim()}
                  className="shrink-0 bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors duration-(--of-duration-instant) hover:bg-accent/60 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
              <p className="mt-1 text-[11px] text-text-tertiary">
                From {value?.branch || selectedRepo.defaultBranch}
              </p>
              {branchError && (
                <p className="mt-1 text-[11px] text-danger">{branchError}</p>
              )}
            </div>
          )}

          <div className="max-h-60 overflow-y-auto">
            {step === "repo" ? (
              filteredRepos.length === 0 ? (
                <div className="px-(--of-space-md) py-(--of-space-lg) text-center text-[13px] text-text-tertiary">
                  {reposLoading ? "Loading repositories…" : "No matching repositories"}
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => handleRepoSelect(repo)}
                    className={`flex w-full items-center gap-2 px-(--of-space-md) py-2 text-left text-[13px] transition-colors duration-(--of-duration-instant) hover:bg-surface-2 border-l-2 ${
                      value?.repo === repo.fullName
                        ? "border-l-accent bg-surface-2 text-text-primary"
                        : "border-l-transparent text-text-secondary"
                    }`}
                  >
                    <span className="truncate font-mono">{repo.fullName}</span>
                  </button>
                ))
              )
            ) : filteredBranches.length === 0 ? (
              <div className="px-(--of-space-md) py-(--of-space-lg) text-center text-[13px] text-text-tertiary">
                {branchesLoading ? "Loading branches…" : "No matching branches"}
              </div>
            ) : (
              filteredBranches.map((branch) => (
                <button
                  key={branch.name}
                  type="button"
                  onClick={() => handleBranchSelect(branch.name)}
                  className={`flex w-full items-center gap-2 px-(--of-space-md) py-2 text-left text-[13px] transition-colors duration-(--of-duration-instant) hover:bg-surface-2 border-l-2 ${
                    value?.branch === branch.name
                      ? "border-l-accent bg-surface-2 text-text-primary"
                      : "border-l-transparent text-text-secondary"
                  }`}
                >
                  <GitBranch className="h-3 w-3 shrink-0 text-text-tertiary" />
                  <span className="truncate font-mono">{branch.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
