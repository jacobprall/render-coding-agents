import type { Adapter, AdapterAccount } from "@auth/core/adapters";
import { encryptToken, decryptTokenSafe } from "@openforge/shared/lib/encryption";

export function drizzleAdapterWithEncryptedForgeTokens(base: Adapter): Adapter {
  return {
    ...base,
    async linkAccount(data: AdapterAccount) {
      const access_token =
        data.access_token != null && data.access_token !== ""
          ? encryptToken(data.access_token)
          : data.access_token;
      await base.linkAccount!({ ...data, access_token });
    },
    async getAccount(providerAccountId: string, provider: string) {
      const acc = await base.getAccount!(providerAccountId, provider);
      if (!acc?.access_token) return acc;
      return {
        ...acc,
        access_token: decryptTokenSafe(acc.access_token),
      };
    },
  };
}
