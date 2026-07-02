import { Router } from "express";
import {
    comboBuilder,
    createCombo,
    deleteCombo,
    editCombo,
    fetchCombosByClassification,
    getCombosByShop,
} from "../controllers/combos/combos.controller.js";
import { isBuyer } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { buyerReadRateLimit, expensiveReadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const comboRouter = Router();

comboRouter.use(verifyJWT);

comboRouter.route("/builder").get(expensiveReadRateLimit, comboBuilder);
comboRouter.route("/classification").get(expensiveReadRateLimit, fetchCombosByClassification);
comboRouter.route("/buyer/:shopId/fetchcombos").get(isBuyer, buyerReadRateLimit, getCombosByShop);
comboRouter.route("/shop/:shopId").get(buyerReadRateLimit, getCombosByShop);
comboRouter.route("/create").post(writeRateLimit, createCombo);
comboRouter.route("/:comboId").patch(writeRateLimit, editCombo).delete(writeRateLimit, deleteCombo);
