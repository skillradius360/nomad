-- CreateEnum
CREATE TYPE "AdTarget" AS ENUM ('GLOBAL', 'INDIVIDUAL');

-- CreateTable
CREATE TABLE "BuyerAds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "target" "AdTarget" NOT NULL DEFAULT 'GLOBAL',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerAds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerAdTarget" (
    "id" TEXT NOT NULL,
    "buyerAdId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerAdTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTag" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboTag" (
    "id" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComboTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuyerAds_active_target_startsAt_endsAt_idx" ON "BuyerAds"("active", "target", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "BuyerAdTarget_buyerId_idx" ON "BuyerAdTarget"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerAdTarget_buyerAdId_buyerId_key" ON "BuyerAdTarget"("buyerAdId", "buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "ItemTag_tagId_idx" ON "ItemTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemTag_itemId_tagId_key" ON "ItemTag"("itemId", "tagId");

-- CreateIndex
CREATE INDEX "ComboTag_tagId_idx" ON "ComboTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboTag_comboId_tagId_key" ON "ComboTag"("comboId", "tagId");

-- AddForeignKey
ALTER TABLE "BuyerAdTarget" ADD CONSTRAINT "BuyerAdTarget_buyerAdId_fkey" FOREIGN KEY ("buyerAdId") REFERENCES "BuyerAds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerAdTarget" ADD CONSTRAINT "BuyerAdTarget_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTag" ADD CONSTRAINT "ItemTag_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemTag" ADD CONSTRAINT "ItemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboTag" ADD CONSTRAINT "ComboTag_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboTag" ADD CONSTRAINT "ComboTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
