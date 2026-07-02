import { Router } from "express";
import {
    createMenu,
    deleteMenu,
    editMenu,
    fetchRunningMenusByShop,
    reorderMenus,
} from "../controllers/menu/menu.controller.js";
import { isBuyer } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { buyerReadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const menuRouter = Router();

menuRouter.use(verifyJWT);

menuRouter.route("/buyer/:shopId/fetchmenus").get(isBuyer, buyerReadRateLimit, fetchRunningMenusByShop);
menuRouter.route("/shop/:shopId/running").get(buyerReadRateLimit, fetchRunningMenusByShop);
menuRouter.route("/create").post(writeRateLimit, createMenu);
menuRouter.route("/reorder").patch(writeRateLimit, reorderMenus);
menuRouter.route("/:menuId").patch(writeRateLimit, editMenu).delete(writeRateLimit, deleteMenu);
