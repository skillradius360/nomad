import { prisma } from "../db/index.js";
import { apiError, asyncHandler } from "../utils/handler.js";

const getCurrentUser = async (userId) => {
    if (!userId) {
        throw new apiError(401, "Unauthorized user");
    }

    const user = await prisma.user.findUnique({
        where: {
            id: userId,
        },
        select: {
            id: true,
            role: true,
            isBlocked: true,
        },
    });

    if (!user || user.isBlocked) {
        throw new apiError(401, "User blocked or unauthorized");
    }

    return user;
};

const hasRole = (role, message) => {
    return asyncHandler(async (req, res, next) => {
        const user = await getCurrentUser(req.userData?.id);

        if (user.role !== role) {
            throw new apiError(403, message);
        }

        req.currentUser = user;
        next();
    });
};

const isAdmin = hasRole("ADMIN", "Admin access required");
const isSeller = hasRole("SELLER", "Seller access required");
const isBuyer = hasRole("BUYER", "Buyer access required");


// ***************************************************************************

const isSelfOrAdmin = asyncHandler(async (req, res, next) => {
    const userId = req.userData?.id;
    const targetUserId = req.params.userId;

    if (!userId) {
        throw new apiError(401, "Unauthorized user");
    }

    if (!targetUserId) {
        throw new apiError(400, "Invalid user id");
    }

    const user = await getCurrentUser(userId);

    if (user.role === "ADMIN" || userId === targetUserId) {
        req.currentUser = user;
        return next();
    }

    throw new apiError(403, "You can only manage your own account");
});

export { isAdmin, isBuyer, isSeller, isSelfOrAdmin };
