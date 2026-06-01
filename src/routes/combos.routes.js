import { Router } from "express";
import {
    comboBuilder,
    createCombo,
    deleteCombo,
    editCombo,
    getCombosByShop,
} from "../controllers/combos/combos.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const comboRouter = Router();

comboRouter.use(verifyJWT);

comboRouter.route("/builder").get(comboBuilder);
comboRouter.route("/shop/:shopId").get(getCombosByShop);
comboRouter.route("/create").post(createCombo);
comboRouter.route("/:comboId").patch(editCombo).delete(deleteCombo);
