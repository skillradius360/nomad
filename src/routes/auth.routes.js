import { Router } from "express";
import { googleAuth, googleCallback, otpAuth, otpCheck, invalidateExpiredOtp } from "../controllers/auth/Oauth.controller.js";
import { authRateLimit } from "../middleware/rateLimit.middleware.js";
export const authRouter = Router()

authRouter.route("/google").get(googleAuth)
authRouter.route("/google/callback").get(googleCallback)
authRouter.route("/generateOTP").post(authRateLimit, otpAuth)
authRouter.route("/verifyOTP").post(authRateLimit, otpCheck)
authRouter.route("/invalidateOTP").delete(invalidateExpiredOtp)
