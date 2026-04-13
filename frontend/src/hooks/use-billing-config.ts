import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/api/client";
import { BillingConfig } from "@/types";
import {
  DEFAULT_BILLING_DISPLAY_DECIMALS,
  normalizeBillingConfig,
} from "@/lib/billing";

export const BILLING_CONFIG_QUERY_KEY = ["billing-config"] as const;

export function useBillingConfig() {
  return useQuery({
    queryKey: BILLING_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const response = await apiClient.getBillingConfig();
      return normalizeBillingConfig(response.data as BillingConfig | undefined);
    },
    staleTime: 60_000,
    placeholderData: {
      displayDecimals: DEFAULT_BILLING_DISPLAY_DECIMALS,
    },
  });
}
