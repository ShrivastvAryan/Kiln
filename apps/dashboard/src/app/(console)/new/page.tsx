import type { Metadata } from 'next';
import { NewDeploymentPage } from '@/views/NewDeployment';

export const metadata: Metadata = { title: 'New deployment' };

export default function Page() {
  return <NewDeploymentPage />;
}
