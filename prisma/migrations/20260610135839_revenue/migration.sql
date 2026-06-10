-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('BUY_X_GET_Y', 'PERCENT_DISCOUNT', 'FLAT_DISCOUNT', 'FREE_DELIVERY', 'COMBO_DISCOUNT');

-- CreateEnum
CREATE TYPE "OfferMenuScope" AS ENUM ('ALL_MENUS', 'SPECIFIC_MENUS');

-- CreateEnum
CREATE TYPE "OfferApplyTo" AS ENUM ('SPECIFIC_ITEMS', 'SPECIFIC_COMBOS', 'ALL_ITEMS_IN_SELECTED_COMBOS');

-- CreateEnum
CREATE TYPE "OfferAudienceType" AS ENUM ('ALL_BUYERS', 'SPECIFIC_BUYERS', 'TAG_BASED', 'PREMIUM_CUSTOMERS', 'NEW_CUSTOMERS');

-- CreateEnum
CREATE TYPE "OfferStackingMode" AS ENUM ('EXCLUSIVE', 'STACKABLE');

-- CreateEnum
CREATE TYPE "OfferDiscountType" AS ENUM ('PERCENTAGE', 'FLAT', 'FREE');

-- CreateEnum
CREATE TYPE "OfferSelectionRole" AS ENUM ('APPLIES_TO', 'CUSTOMER_BUYS', 'CUSTOMER_GETS');

-- CreateEnum
CREATE TYPE "RevenuePeriodType" AS ENUM ('DAILY', 'MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryDiscountAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paidAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "offerType" "OfferType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "menuScope" "OfferMenuScope" NOT NULL DEFAULT 'ALL_MENUS',
    "applyTo" "OfferApplyTo" NOT NULL,
    "audienceType" "OfferAudienceType" NOT NULL DEFAULT 'ALL_BUYERS',
    "stackingMode" "OfferStackingMode" NOT NULL DEFAULT 'EXCLUSIVE',
    "minQuantity" INTEGER,
    "minOrderAmount" INTEGER,
    "discountType" "OfferDiscountType",
    "discountValue" DOUBLE PRECISION,
    "maxDiscountAmount" INTEGER,
    "rewardQuantity" INTEGER,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferMenu" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferItem" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "shopItemId" TEXT NOT NULL,
    "role" "OfferSelectionRole" NOT NULL DEFAULT 'APPLIES_TO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferCombo" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "role" "OfferSelectionRole" NOT NULL DEFAULT 'APPLIES_TO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferCombo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferBuyer" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferBuyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferAudienceTag" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferAudienceTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopRevenueSummary" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodType" "RevenuePeriodType" NOT NULL,
    "periodDate" TIMESTAMP(3) NOT NULL,
    "successfulOrders" INTEGER NOT NULL DEFAULT 0,
    "cancelledOrders" INTEGER NOT NULL DEFAULT 0,
    "grossRevenue" INTEGER NOT NULL DEFAULT 0,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "deliveryRevenue" INTEGER NOT NULL DEFAULT 0,
    "refundAmount" INTEGER NOT NULL DEFAULT 0,
    "netRevenue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopRevenueSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Offer_shopId_active_startsAt_endsAt_idx" ON "Offer"("shopId", "active", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Offer_audienceType_idx" ON "Offer"("audienceType");

-- CreateIndex
CREATE INDEX "OfferMenu_menuId_idx" ON "OfferMenu"("menuId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferMenu_offerId_menuId_key" ON "OfferMenu"("offerId", "menuId");

-- CreateIndex
CREATE INDEX "OfferItem_shopItemId_idx" ON "OfferItem"("shopItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferItem_offerId_shopItemId_role_key" ON "OfferItem"("offerId", "shopItemId", "role");

-- CreateIndex
CREATE INDEX "OfferCombo_comboId_idx" ON "OfferCombo"("comboId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferCombo_offerId_comboId_role_key" ON "OfferCombo"("offerId", "comboId", "role");

-- CreateIndex
CREATE INDEX "OfferBuyer_buyerId_idx" ON "OfferBuyer"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferBuyer_offerId_buyerId_key" ON "OfferBuyer"("offerId", "buyerId");

-- CreateIndex
CREATE INDEX "OfferAudienceTag_tagId_idx" ON "OfferAudienceTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferAudienceTag_offerId_tagId_key" ON "OfferAudienceTag"("offerId", "tagId");

-- CreateIndex
CREATE INDEX "ShopRevenueSummary_shopId_periodType_periodDate_idx" ON "ShopRevenueSummary"("shopId", "periodType", "periodDate");

-- CreateIndex
CREATE UNIQUE INDEX "ShopRevenueSummary_shopId_periodType_periodDate_key" ON "ShopRevenueSummary"("shopId", "periodType", "periodDate");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferMenu" ADD CONSTRAINT "OfferMenu_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferMenu" ADD CONSTRAINT "OfferMenu_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferItem" ADD CONSTRAINT "OfferItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferItem" ADD CONSTRAINT "OfferItem_shopItemId_fkey" FOREIGN KEY ("shopItemId") REFERENCES "ShopItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCombo" ADD CONSTRAINT "OfferCombo_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCombo" ADD CONSTRAINT "OfferCombo_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferBuyer" ADD CONSTRAINT "OfferBuyer_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferBuyer" ADD CONSTRAINT "OfferBuyer_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferAudienceTag" ADD CONSTRAINT "OfferAudienceTag_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferAudienceTag" ADD CONSTRAINT "OfferAudienceTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopRevenueSummary" ADD CONSTRAINT "ShopRevenueSummary_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
