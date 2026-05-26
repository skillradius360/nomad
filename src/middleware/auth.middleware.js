import { asyncHandler, apiError } from "../utils/handler.js";
import { decodeJWT } from "../utils/jwtPacker.js";

const getAccessTokenFromHeaders = (req) => {
    const authHeader = req.headers.authorization;

    if (authHeader?.startsWith("Bearer ")) {
        return authHeader.split(" ")[1];
    }

    return req.headers.accesstoken || req.headers["access-token"];
};

const verifyJWT = asyncHandler(async (req, res, next) => {
    const accessToken = getAccessTokenFromHeaders(req);

    if (!accessToken) {
        throw new apiError(401, "Access token missing");
    }

    try {
        const decodedToken = decodeJWT(accessToken, process.env.ACCESS_TOKEN_SECRET);
        req.userData = decodedToken;
        next();
    } catch (error) {
        throw new apiError(401, "Invalid or expired access token.Please login");
    }
});

export { verifyJWT };
