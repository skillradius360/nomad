import { Router } from "express";
import {
    createItems,
    deleteItem,
    editItem,
    fetchAllItems,
    fetchItemsToCategory,
    fetchOnlyItems,
    mapItems,
    addPersonalProduct,
} from "../controllers/items/items.controller.js";
import { isAdmin, isSeller } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const itemRouter = Router();

itemRouter.use(verifyJWT);

itemRouter.route("/").get(fetchAllItems);
itemRouter.route("/create").post(isAdmin, createItems);
itemRouter.route("/map").post(isAdmin, mapItems);
itemRouter.route("/custom").post(isSeller, addPersonalProduct);
itemRouter.route("/fetchallitems").get(fetchAllItems);
itemRouter.route("/only").get(fetchOnlyItems);
itemRouter.route("/category").get(fetchItemsToCategory);
itemRouter.route("/category/:categoryName").get(fetchItemsToCategory);
itemRouter.route("/:itemId").patch(isAdmin, editItem).delete(isAdmin, deleteItem);
