import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { SystemConfig } from "@/types";
import { DEFAULT_SYSTEM_CONFIG, normalizeSystemConfig } from "@/lib/system-config";

export const SYSTEM_CONFIG_QUERY_KEY = ["system-config"] as const;

export function useSystemConfig() {
  return useQuery({
    queryKey: SYSTEM_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const response = await apiClient.getSystemConfig();
      return normalizeSystemConfig(response.data as SystemConfig | undefined);
    },
    staleTime: 60_000,
    placeholderData: DEFAULT_SYSTEM_CONFIG,
  });
}
