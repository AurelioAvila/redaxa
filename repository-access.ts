// Plan labels may change; existing Stripe 'personal' subscriptions are Redaxa Pro.
export function repositoryEntitled(account: unknown): boolean {
  if (!account || typeof account !== 'object') return false;
  const a = account as Record<string, unknown>;
  if(typeof a.repositoryAccess === 'boolean') return a.active === true && a.repositoryAccess;
  return a.active === true && ['active', 'trialing'].includes(String(a.status))
    && ['personal', 'pro', 'business'].includes(String(a.plan));
}

export async function verifyRepositoryAccess(authorization: string | undefined, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!authorization || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization) || authorization.length > 8192) return false;
  try {
    const response = await fetcher('https://promptshield-beta.vercel.app/api/account', {
      headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(15_000)
    });
    return response.ok && repositoryEntitled(await response.json());
  } catch { return false; }
}
