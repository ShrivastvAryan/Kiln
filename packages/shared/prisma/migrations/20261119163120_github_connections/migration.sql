-- CreateTable
CREATE TABLE "github_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "github_user_id" BIGINT NOT NULL,
    "login" TEXT NOT NULL,
    "avatar_url" TEXT,
    "installation_ids" BIGINT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_connections_user_id_key" ON "github_connections"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "github_connections_github_user_id_key" ON "github_connections"("github_user_id");

-- AddForeignKey
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

