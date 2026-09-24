import { useQuery } from "@tanstack/react-query";

// Mock only — Fase 1 (visual). Will be replaced by a real GitHub-backed
// endpoint (compares the installed version against the latest tag on the
// private repo) in a later phase. Alternates the result on every check so
// both UI states can be previewed without a backend.
const INSTALLED_VERSION = "4.5";
const MOCK_LATEST_VERSION = "4.6";

export const UPDATE_CHECK_QUERY_KEY = ["mock-update-check"];

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string;
  installedVersion: string;
}

let mockToggle = false;

async function mockCheckForUpdate(): Promise<UpdateCheckResult> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  mockToggle = !mockToggle;
  return {
    hasUpdate: mockToggle,
    latestVersion: mockToggle ? MOCK_LATEST_VERSION : INSTALLED_VERSION,
    installedVersion: INSTALLED_VERSION,
  };
}

export function useUpdateCheck() {
  return useQuery({
    queryKey: UPDATE_CHECK_QUERY_KEY,
    queryFn: mockCheckForUpdate,
    enabled: false,
    staleTime: Infinity,
  });
}
