import { Router } from "express";
import {
    createItems,
    deleteItem,
    editItem,
    fetchAllItems,
    fetchItemsToCategory,
    fetchOnlyItems,
    fetchItemsByShop,
    mapItems,
    addPersonalProduct,
    editShopItem,
    deleteShopItem,
    reorderItems,
    reorderShopItems,
} from "../controllers/items/items.controller.js";
import { isAdmin, isAdminOrSeller, isSeller } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/multer.middleware.js";

export const itemRouter = Router();
const itemImageUpload = upload.fields([
    {name:"itemImg", maxCount:1}
]);

itemRouter.use(verifyJWT);

itemRouter.route("/").get(fetchAllItems);
itemRouter.route("/create").post(isAdminOrSeller, itemImageUpload, createItems);
itemRouter.route("/map").post(isAdmin, mapItems);
itemRouter.route("/custom").post(isSeller, itemImageUpload, addPersonalProduct);
itemRouter.route("/reorder").patch(isAdmin, reorderItems);
itemRouter.route("/shop-items/reorder").patch(isAdminOrSeller, reorderShopItems);
itemRouter.route("/fetchallitems").get(fetchAllItems);
itemRouter.route("/only").get(fetchOnlyItems);
itemRouter.route("/shop-items/:shopItemId").patch(itemImageUpload, editShopItem).delete(deleteShopItem);
itemRouter.route("/shop/:shopId").get(fetchItemsByShop);
itemRouter.route("/category").get(fetchItemsToCategory);
itemRouter.route("/category/:categoryName").get(fetchItemsToCategory);
itemRouter.route("/:itemId").patch(isAdmin, itemImageUpload, editItem).delete(isAdmin, deleteItem);
