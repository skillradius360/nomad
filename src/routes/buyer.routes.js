import { Router } from "express";
import { createBuyer, createBuyerByAdmin, deleteBuyer, getBuyerProfile } from "../controllers/buyers/buyer.controller.js";
import { isAdmin, isBuyer } from "../middleware/admin.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const buyerRouter = Router();

buyerRouter.use(verifyJWT);

buyerRouter.route("/create/:userId").post(isAdmin, createBuyerByAdmin);


buyerRouter.route("/create").post(createBuyer);
buyerRouter.route("/me").get(isBuyer, getBuyerProfile).delete(isBuyer, deleteBuyer);
