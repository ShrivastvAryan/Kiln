-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('cloning', 'queued', 'building', 'uploading', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "LogStream" AS ENUM ('stdout', 'stderr', 'system');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repo_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "repo_url" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'cloning',
    "url" TEXT NOT NULL,
    "commit_sha" TEXT,
    "commit_message" TEXT,
    "commit_author" TEXT,
    "framework" TEXT,
    "package_manager" TEXT,
    "install_command" TEXT,
    "build_command" TEXT,
    "output_dir" TEXT,
    "worker_id" TEXT,
    "file_count" INTEGER,
    "total_bytes" BIGINT,
    "build_duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_logs" (
    "deployment_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "stream" "LogStream" NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "build_logs_pkey" PRIMARY KEY ("deployment_id","seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_repo_url_key" ON "projects"("repo_url");

-- CreateIndex
CREATE INDEX "deployments_created_at_idx" ON "deployments"("created_at" DESC);

-- CreateIndex
CREATE INDEX "deployments_project_id_created_at_idx" ON "deployments"("project_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deployments_status_idx" ON "deployments"("status");

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_logs" ADD CONSTRAINT "build_logs_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
