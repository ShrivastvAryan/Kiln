import type { ReactNode } from 'react';
import { Shell } from '@/components/Layout';
import { DeploymentsProvider } from '@/hooks/deployments';

/** Console routes (/deployments, /new, /system) share the sidebar shell and the live data store. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <DeploymentsProvider>
      <Shell>{children}</Shell>
    </DeploymentsProvider>
  );
}
