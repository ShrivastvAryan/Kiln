import type { Metadata } from 'next';
import { DeploymentDetailPage } from '@/views/DeploymentDetail';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Deployment ${id}` };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <DeploymentDetailPage id={id} />;
}
