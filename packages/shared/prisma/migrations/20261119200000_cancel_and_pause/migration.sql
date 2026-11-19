-- AlterEnum
ALTER TYPE "DeploymentStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "deployments" ADD COLUMN     "paused_at" TIMESTAMP(3);

