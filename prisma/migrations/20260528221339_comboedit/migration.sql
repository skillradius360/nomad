/*
  Warnings:

  - You are about to drop the column `comboTypeId` on the `Combo` table. All the data in the column will be lost.
  - You are about to drop the `ComboType` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Combo" DROP CONSTRAINT "Combo_comboTypeId_fkey";

-- DropForeignKey
ALTER TABLE "ComboType" DROP CONSTRAINT "ComboType_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "ComboType" DROP CONSTRAINT "ComboType_cuisineId_fkey";

-- AlterTable
ALTER TABLE "Combo" DROP COLUMN "comboTypeId";

-- DropTable
DROP TABLE "ComboType";
