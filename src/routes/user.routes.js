import { Router } from "express";
import { upload } from "../middleware/multer.middleware.js";
import {
    SuspendUser,
    deleteUser,
    editUserData,
    editOwnUserData,
    fetchAllSellers,
    fetchAllBuyers,
    fetchUserProfile,
    fetchAllUsers} from "../controllers/users/user.controller.js";
import { isAdmin, isSelfOrAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const userRouter = Router();

userRouter.use(verifyJWT);

userRouter.route("/").get(isAdmin, fetchAllUsers);
userRouter.route("/suspend/:userId").patch(isAdmin, SuspendUser);
userRouter.route("/sellers").get(isAdmin,fetchAllSellers);
userRouter.route("/buyers").get(isAdmin,fetchAllBuyers);

userRouter.route("/delUser/:userId").delete(isSelfOrAdmin, deleteUser);
userRouter.route("/modUser/:userId").patch(isSelfOrAdmin, editUserData)

userRouter.route("/me").get( fetchUserProfile).patch(upload.fields([{name:"avatar", maxCount:1}]),editOwnUserData)
