import { Router } from "express";
import {
    createCategory,
    deleteCategory,
    editCategory,
    fetchAllCategories,
    fetchCategoryToCuisine,
    fetchOnlyCategories,
    mapCategories,
    reorderCategories,
} from "../controllers/categories/categories.controller.js";
import { isAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const categoryRouter = Router();

categoryRouter.use(verifyJWT);

categoryRouter.route("/create").post(isAdmin, createCategory);
categoryRouter.route("/map").post(isAdmin, mapCategories);
categoryRouter.route("/reorder").patch(isAdmin, reorderCategories);
categoryRouter.route("/fetchallcategories").get(fetchAllCategories);
categoryRouter.route("/only").get(fetchOnlyCategories);
categoryRouter.route("/cuisine").get(fetchCategoryToCuisine);
categoryRouter.route("/cuisine/:cuisineName").get(fetchCategoryToCuisine);
categoryRouter.route("/:categoryId").patch(isAdmin, editCategory).delete(isAdmin, deleteCategory);
