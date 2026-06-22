import { Router } from "express";
import {
    createCategory,
    deleteCategory,
    editCategory,
    fetchAllCategories,
    fetchCategoryToCuisine,
    fetchOnlyCategories,
    fetchShopCategories,
    mapCategories,
    reorderCategories,
} from "../controllers/categories/categories.controller.js";
import { isAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { buyerReadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const categoryRouter = Router();

categoryRouter.use(verifyJWT);

categoryRouter.route("/create").post(isAdmin, writeRateLimit, createCategory);
categoryRouter.route("/map").post(isAdmin, writeRateLimit, mapCategories);
categoryRouter.route("/reorder").patch(isAdmin, writeRateLimit, reorderCategories);
categoryRouter.route("/fetchallcategories").get(buyerReadRateLimit, fetchAllCategories);
categoryRouter.route("/only").get(buyerReadRateLimit, fetchOnlyCategories);
categoryRouter.route("/shop/:shopId").get(buyerReadRateLimit, fetchShopCategories);
categoryRouter.route("/cuisine").get(buyerReadRateLimit, fetchCategoryToCuisine);
categoryRouter.route("/cuisine/:cuisineName").get(buyerReadRateLimit, fetchCategoryToCuisine);
categoryRouter.route("/:categoryId").patch(isAdmin, writeRateLimit, editCategory).delete(isAdmin, writeRateLimit, deleteCategory);
