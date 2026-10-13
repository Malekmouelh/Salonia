-- CreateEnum
CREATE TYPE "AuthEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGOUT', 'REGISTER', 'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET', 'CENTER_CREATED', 'AI_SETUP_APPLIED');

-- AlterTable
ALTER TABLE "Center" ADD COLUMN     "openingHours" JSONB;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "catalogDraft" JSONB;

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "type" "AuthEventType" NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthEvent_userId_createdAt_idx" ON "AuthEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_organizationId_createdAt_idx" ON "AuthEvent"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

