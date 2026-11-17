import type { Metadata } from 'next';
import { SystemPage } from '@/views/System';

export const metadata: Metadata = { title: 'Infrastructure' };

export default function Page() {
  return <SystemPage />;
}
