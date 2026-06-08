import { Router } from "express";
import {
    assignTagsToCombo,
    assignTagsToItem,
    createTag,
    deleteTag,
    fetchActiveTags,
    fetchAllTags,
    fetchTagById,
    removeTagFromCombo,
    removeTagFromItem,
    updateTag,
    updateTagActiveStatus,
} from "../controllers/tags/tags.controller.js";
import { isAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const tagRouter = Router();

tagRouter.use(verifyJWT);

tagRouter.route("/").get(fetchAllTags);
tagRouter.route("/active").get(fetchActiveTags);
tagRouter.route("/create").post(isAdmin, createTag);
tagRouter.route("/items/:itemId").post(isAdmin, assignTagsToItem);
tagRouter.route("/items/:itemId/:tagId").delete(isAdmin, removeTagFromItem);
tagRouter.route("/combos/:comboId").post(isAdmin, assignTagsToCombo);
tagRouter.route("/combos/:comboId/:tagId").delete(isAdmin, removeTagFromCombo);
tagRouter.route("/:tagId/active").patch(isAdmin, updateTagActiveStatus);
tagRouter.route("/:tagId").get(fetchTagById).patch(isAdmin, updateTag).delete(isAdmin, deleteTag);
