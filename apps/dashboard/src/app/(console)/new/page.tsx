import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewDeploymentPage } from '@/views/NewDeployment';

export const metadata: Metadata = { title: 'New deployment' };

export default function Page() {
  return (
    <Suspense>
      <NewDeploymentPage />
    </Suspense>
  );
}
