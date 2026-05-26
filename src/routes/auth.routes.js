import { Router } from "express";
import { googleAuth, googleCallback, otpAuth, otpCheck, invalidateExpiredOtp } from "../controllers/auth/Oauth.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
export const authRouter = Router()

authRouter.route("/google").get(googleAuth)
authRouter.route("/google/callback").get(googleCallback)
authRouter.route("/generateOTP").post(otpAuth)
authRouter.route("/verifyOTP").post(otpCheck)
authRouter.route("/invalidateOTP").delete(invalidateExpiredOtp)
