import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const parseCoordinate = (value, fieldName) => {
    const coordinate = Number(value);

    if (!Number.isFinite(coordinate)) {
        throw new apiError(400, `${fieldName} must be a valid number`);
    }

    return coordinate;
};

const buyerProfileSelect = {
    id: true,
    email: true,
    name: true,
    phone: true,
    role: true,
    latitude: true,
    longitude: true,
    address: true,
    profileImg: true,
    billingPlan: true,
    isVerified: true,
    isBlocked: true,
    createdAt: true,
    updatedAt: true,
};

const buildBuyerProfileData = ({ name, address, latitude, longitude }) => {
    if (!name || !address || latitude === undefined || longitude === undefined) {
        throw new apiError(400, "Buyer name, address, latitude and longitude are required");
    }

    return {
        name: String(name).trim(),
        address: String(address).trim(),
        latitude: parseCoordinate(latitude, "latitude"),
        longitude: parseCoordinate(longitude, "longitude"),
        role: "BUYER",
    };
};

const createBuyer = asyncHandler(async (req, res) => {
    const userId = req.userData?.id;

    if (!userId) {
        throw new apiError(401, "Unauthorized user");
    }

    const currentUser = await prisma.user.findUnique({
        where: {
            id: userId,
        },
        select: {
            id: true,
            role: true,
            isBlocked: true,
        },
    });

    if (!currentUser || currentUser.isBlocked) {
        throw new apiError(401, "User blocked or unauthorized");
    }

    if (currentUser.role && currentUser.role !== "BUYER") {
        throw new apiError(409, "User already has a different role");
    }

    const buyer = await prisma.user.update({
        where: {
            id: userId,
        },
        data: {
            ...buildBuyerProfileData(req.body),
            isVerified: true,
        },
    });

    return res
        .status(201)
        .json(new apiResponse(201, buyer, "Buyer created successfully"));
});

const createBuyerByAdmin = asyncHandler(async (req, res) => {
    const targetUserId = req.params.userId;

    if (!targetUserId) {
        throw new apiError(400, "Invalid user id");
    }

    const targetUser = await prisma.user.findUnique({
        where: {
            id: targetUserId,
        },
        select: {
            id: true,
            role: true,
            isBlocked: true,
        },
    });

    if (!targetUser || targetUser.isBlocked) {
        throw new apiError(401, "Target user blocked or not found");
    }

    if (targetUser.role === "ADMIN" || targetUser.role === "SUPER") {
        throw new apiError(409, "Admin or super user cannot be converted to buyer");
    }

    if (targetUser.role === "SELLER") {
        throw new apiError(409, "Seller already has a different role");
    }

    const buyer = await prisma.user.update({
        where: {
            id: targetUserId,
        },
        data: {
            ...buildBuyerProfileData(req.body),
            isVerified: true,
        },
    });

    return res
        .status(201)
        .json(new apiResponse(201, buyer, "Buyer created by admin successfully"));
});

const editBuyerProfile = asyncHandler(async (req, res) => {
    const userId = req.params.userId || req.userData?.id;
    const requesterId = req.userData?.id;

    if (!userId || !requesterId) {
        throw new apiError(401, "Unauthorized user");
    }

    const currentUser = await prisma.user.findUnique({
        where: {
            id: requesterId,
        },
        select: {
            id: true,
            role: true,
            isBlocked: true,
        },
    });

    if (!currentUser || currentUser.isBlocked) {
        throw new apiError(401, "User blocked or unauthorized");
    }

    if (currentUser.role !== "ADMIN" && currentUser.role !== "BUYER") {
        throw new apiError(403, "Admin or buyer access required");
    }

    if (currentUser.role === "BUYER" && userId !== requesterId) {
        throw new apiError(403, "You can only edit your own buyer profile");
    }

    const allowedFields = ["name", "email", "phone", "address", "profileImg"];
    const updateData = {};

    allowedFields.forEach((field) => {
        if (req.body[field] !== undefined) {
            updateData[field] = req.body[field] === null ? null : String(req.body[field]).trim();
        }
    });

    if (req.body.latitude !== undefined) {
        updateData.latitude = req.body.latitude === null || req.body.latitude === "" ? null : parseCoordinate(req.body.latitude, "latitude");
    }

    if (req.body.longitude !== undefined) {
        updateData.longitude = req.body.longitude === null || req.body.longitude === "" ? null : parseCoordinate(req.body.longitude, "longitude");
    }

    if (Object.keys(updateData).length === 0) {
        throw new apiError(400, "No valid buyer fields received");
    }

    const existingBuyer = await prisma.user.findUnique({
        where:{
            id:userId
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if (!existingBuyer || existingBuyer.isBlocked) {
        throw new apiError(404, "buyer not found or blocked");
    }

    if (existingBuyer.role !== "BUYER") {
        throw new apiError(403, "Target user is not a buyer");
    }

    const buyer = await prisma.user.update({
        where: {
            id: userId,
        },
        data: updateData,
        select: buyerProfileSelect,
    });

    return res
        .status(200)
        .json(new apiResponse(200, buyer, "Buyer profile updated successfully"));
});

const getBuyerProfile = asyncHandler(async (req, res) => {
    const userId = req.userData?.id;

    if (!userId) {
        throw new apiError(401, "Unauthorized user");
    }

    const buyer = await prisma.user.findUnique({
        where: {
            id: userId,
        },
        select: {
            ...buyerProfileSelect,
            orders: {
                orderBy: {
                    createdAt: "desc",
                },
            },
        },
    });

    if (!buyer || buyer.isBlocked) {
        throw new apiError(401, "User blocked or unauthorized");
    }

    if (buyer.role !== "BUYER") {
        throw new apiError(403, "Buyer access required");
    }

    return res
        .status(200)
        .json(new apiResponse(200, buyer, "Buyer profile fetched successfully"));
});

const deleteBuyer = asyncHandler(async (req, res) => {
    const userId = req.userData?.id;

    if (!userId) {
        throw new apiError(401, "Unauthorized user");
    }

    await prisma.user.delete({
        where: {
            id: userId,
        },
    });

    return res
        .status(200)
        .json(new apiResponse(200, null, "Buyer deleted successfully"));
});

export { createBuyer, createBuyerByAdmin, editBuyerProfile, getBuyerProfile, deleteBuyer };
