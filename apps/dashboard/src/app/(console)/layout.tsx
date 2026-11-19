import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/AuthGuard';
import { Shell } from '@/components/Layout';
import { DeploymentsProvider } from '@/hooks/deployments';

/** Console routes (/deployments, /new): signed-in only, sharing the sidebar shell and live data store. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <DeploymentsProvider>
        <Shell>{children}</Shell>
      </DeploymentsProvider>
    </AuthGuard>
  );
}
