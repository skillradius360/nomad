import { Router } from "express";
import { createCuisine, deleteCuisine, editCuisine, fetchAllCuisines, fetchOnlyCuisines, fetchShopCuisines, reorderCuisines } from "../controllers/cuisine/cuisine.controller.js";
import { isAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { buyerReadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const cuisineRouter = Router();

cuisineRouter.use(verifyJWT);

cuisineRouter.route("/").get(buyerReadRateLimit, fetchAllCuisines);
cuisineRouter.route("/create").post(isAdmin, writeRateLimit, createCuisine);
cuisineRouter.route("/reorder").patch(isAdmin, writeRateLimit, reorderCuisines);
cuisineRouter.route("/fetchallcuisines").get(buyerReadRateLimit, fetchAllCuisines);
cuisineRouter.route("/only").get(buyerReadRateLimit, fetchOnlyCuisines);
cuisineRouter.route("/shop/:shopId").get(buyerReadRateLimit, fetchShopCuisines);
cuisineRouter.route("/:cuisineId").patch(isAdmin, writeRateLimit, editCuisine).delete(isAdmin, writeRateLimit, deleteCuisine);
