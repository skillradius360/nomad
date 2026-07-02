import { Router } from "express";
import {
    createItems,
    deleteItem,
    editItem,
    fetchAllItems,
    fetchItemsToCategory,
    fetchOnlyItems,
    fetchMasterItemsForShop,
    fetchItemsByShop,
    mapItems,
    addPersonalProduct,
    editShopItem,
    deleteShopItem,
    reorderItems,
    reorderShopItems,
} from "../controllers/items/items.controller.js";
import { isAdmin, isAdminOrSeller, isBuyer, isSeller } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/multer.middleware.js";
import { buyerReadRateLimit, expensiveReadRateLimit, uploadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const itemRouter = Router();
const itemImageUpload = upload.fields([
    {name:"itemImg", maxCount:1}
]);

itemRouter.use(verifyJWT);

itemRouter.route("/").get(expensiveReadRateLimit, fetchAllItems);
itemRouter.route("/create").post(isAdminOrSeller, uploadRateLimit, itemImageUpload, createItems);
itemRouter.route("/map").post(isAdmin, writeRateLimit, mapItems);
itemRouter.route("/custom").post(isSeller, uploadRateLimit, itemImageUpload, addPersonalProduct);
itemRouter.route("/reorder").patch(isAdmin, writeRateLimit, reorderItems);
itemRouter.route("/shop-items/reorder").patch(isAdminOrSeller, writeRateLimit, reorderShopItems);
itemRouter.route("/fetchallitems").get( fetchAllItems);
itemRouter.route("/only").get(buyerReadRateLimit, fetchOnlyItems);
itemRouter.route("/master/shop/:shopId").get(isAdminOrSeller, expensiveReadRateLimit, fetchMasterItemsForShop);
itemRouter.route("/shop-items/:shopItemId").patch(uploadRateLimit, itemImageUpload, editShopItem).delete(writeRateLimit, deleteShopItem);
itemRouter.route("/buyer/:shopId/fetchitems").get(isBuyer, buyerReadRateLimit, fetchItemsByShop);
itemRouter.route("/shop/:shopId").get(buyerReadRateLimit, fetchItemsByShop);
itemRouter.route("/category").get(expensiveReadRateLimit, fetchItemsToCategory);
itemRouter.route("/category/:categoryName").get(expensiveReadRateLimit, fetchItemsToCategory);
itemRouter.route("/:itemId").patch(isAdmin, uploadRateLimit, itemImageUpload, editItem).delete(isAdmin, writeRateLimit, deleteItem);
