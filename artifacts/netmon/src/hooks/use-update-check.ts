import { useCheckSystemUpdate, getCheckSystemUpdateQueryKey } from "@workspace/api-client-react";

export function useUpdateCheck() {
  return useCheckSystemUpdate({
    query: {
      queryKey: getCheckSystemUpdateQueryKey(),
      enabled: false,
      staleTime: Infinity,
    },
  });
}
