import type { Metadata } from 'next';
import { DashboardPage } from '@/views/Dashboard';

export const metadata: Metadata = { title: 'Deployments' };

export default function Page() {
  return <DashboardPage />;
}
