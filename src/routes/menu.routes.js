import { Router } from "express";
import {
    createMenu,
    deleteMenu,
    editMenu,
    fetchRunningMenusByShop,
} from "../controllers/menu/menu.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const menuRouter = Router();

menuRouter.use(verifyJWT);

menuRouter.route("/shop/:shopId/running").get(fetchRunningMenusByShop);
menuRouter.route("/create").post(createMenu);
menuRouter.route("/:menuId").patch(editMenu).delete(deleteMenu);
