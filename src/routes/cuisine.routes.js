import { Router } from "express";
import { createCuisine, deleteCuisine, editCuisine, fetchAllCuisines, fetchOnlyCuisines, fetchShopCuisines, reorderCuisines } from "../controllers/cuisine/cuisine.controller.js";
import { isAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const cuisineRouter = Router();

cuisineRouter.use(verifyJWT);

cuisineRouter.route("/").get(fetchAllCuisines);
cuisineRouter.route("/create").post(isAdmin, createCuisine);
cuisineRouter.route("/reorder").patch(isAdmin, reorderCuisines);
cuisineRouter.route("/fetchallcuisines").get(fetchAllCuisines);
cuisineRouter.route("/only").get(fetchOnlyCuisines);
cuisineRouter.route("/shop/:shopId").get(fetchShopCuisines);
cuisineRouter.route("/:cuisineId").patch(isAdmin, editCuisine).delete(isAdmin, deleteCuisine);
