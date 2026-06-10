/*
  Warnings:

  - You are about to drop the column `discount` on the `ShopItem` table. All the data in the column will be lost.
  - You are about to drop the column `discountPercentage` on the `ShopItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ShopItem" DROP COLUMN "discount",
DROP COLUMN "discountPercentage";
