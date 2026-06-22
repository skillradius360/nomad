import { Router } from "express";
import {
    createMenu,
    deleteMenu,
    editMenu,
    fetchRunningMenusByShop,
    reorderMenus,
} from "../controllers/menu/menu.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { buyerReadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const menuRouter = Router();

menuRouter.use(verifyJWT);

menuRouter.route("/shop/:shopId/running").get(buyerReadRateLimit, fetchRunningMenusByShop);
menuRouter.route("/create").post(writeRateLimit, createMenu);
menuRouter.route("/reorder").patch(writeRateLimit, reorderMenus);
menuRouter.route("/:menuId").patch(writeRateLimit, editMenu).delete(writeRateLimit, deleteMenu);
