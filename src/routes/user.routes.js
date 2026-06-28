import { Router } from "express";
import { upload } from "../middleware/multer.middleware.js";
import {
    toggleUserSuspension,
    deleteUser,
    editUserData,
    editOwnUserData,
    fetchAdminBuyerById,
    fetchAdminSellerById,
    fetchAdminShopById,
    fetchAdminShops,
    fetchAllSellers,
    fetchAllBuyers,
    fetchUserProfile,
    fetchAllUserOverviewData,
    updateAdminUserStatus,
    fetchAllUsers} from "../controllers/users/user.controller.js";
import { isAdmin, isSelfOrAdmin } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { adminHeavyRateLimit, uploadRateLimit, writeRateLimit } from "../middleware/rateLimit.middleware.js";

export const userRouter = Router();

userRouter.use(verifyJWT);

userRouter.route("/all-data").get(isAdmin, adminHeavyRateLimit, fetchAllUserOverviewData);
userRouter.route("/").get(isAdmin, adminHeavyRateLimit, fetchAllUsers);
userRouter.route("/admin/shops").get(isAdmin, adminHeavyRateLimit, fetchAdminShops);
userRouter.route("/admin/shops/:shopId").get(isAdmin, adminHeavyRateLimit, fetchAdminShopById);
userRouter.route("/admin/buyers").get(isAdmin, adminHeavyRateLimit, fetchAllBuyers);
userRouter.route("/admin/buyers/:buyerId").get(isAdmin, adminHeavyRateLimit, fetchAdminBuyerById);
userRouter.route("/admin/buyers/:buyerId/status").patch(isAdmin, writeRateLimit, updateAdminUserStatus);
userRouter.route("/admin/sellers").get(isAdmin, adminHeavyRateLimit, fetchAllSellers);
userRouter.route("/admin/sellers/:sellerId").get(isAdmin, adminHeavyRateLimit, fetchAdminSellerById);
userRouter.route("/admin/sellers/:sellerId/status").patch(isAdmin, writeRateLimit, updateAdminUserStatus);
userRouter.route("/suspend/:userId").patch(isAdmin, writeRateLimit, toggleUserSuspension);
userRouter.route("/sellers").get(isAdmin,adminHeavyRateLimit,fetchAllSellers);
userRouter.route("/buyers").get(isAdmin,adminHeavyRateLimit,fetchAllBuyers);

userRouter.route("/delUser/:userId").delete(isSelfOrAdmin, writeRateLimit, deleteUser);
userRouter.route("/modUser/:userId").patch(isSelfOrAdmin, writeRateLimit, editUserData)

userRouter.route("/me").get(fetchUserProfile).patch(uploadRateLimit, upload.fields([{name:"avatar", maxCount:1}]),editOwnUserData)
