import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";

const parseCoordinate = (value, fieldName) => {
    const coordinate = Number(value);

    if (!Number.isFinite(coordinate)) {
        throw new apiError(400, `${fieldName} must be a valid number`);
    }

    return coordinate;
};

const sellerEditableFields = ["name", "address", "latitude", "longitude"];

const sellerProfileSelect = {
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

const buildSellerProfileData = ({ name, address, latitude, longitude }) => {
    if (!name || !address || latitude === undefined || longitude === undefined) {
        throw new apiError(400, "Seller name, address, latitude and longitude are required");
    }

    return {
        name: String(name).trim(),
        address: String(address).trim(),
        latitude: parseCoordinate(latitude, "latitude"),
        longitude: parseCoordinate(longitude, "longitude"),
        role: "SELLER",
    };
};

const createSeller = asyncHandler(async (req, res) => {
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

    if (currentUser.role && currentUser.role !== "SELLER") {
        throw new apiError(409, "User already has a different role");
    }

    const seller = await prisma.user.update({
        where: {
            id: userId,
        },
        data: {
            ...buildSellerProfileData(req.body),
            isVerified: false,
        },
    });

    return res
        .status(201)
        .json(new apiResponse(201, seller, "Seller created successfully"));
});

const createSellerByAdmin = asyncHandler(async (req, res) => {
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
        throw new apiError(409, "Admin or super user cannot be converted to seller");
    }

    if (targetUser.role === "BUYER") {
        throw new apiError(409, "Buyer already has a different role");
    }

    const seller = await prisma.user.update({
        where: {
            id: targetUserId,
        },
        data: {
            ...buildSellerProfileData(req.body),
            isVerified: true,
        },
    });

    return res
        .status(201)
        .json(new apiResponse(201, seller, "Seller created by admin successfully"));
});

const getSellerProfile = asyncHandler(async (req, res) => {
    const userId = req.userData?.id;

    if (!userId) {
        throw new apiError(401, "Unauthorized user");
    }

    const seller = await prisma.user.findUnique({
        where: {
            id: userId,
        },
        select: {
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
            shops: {
                orderBy: {
                    createdAt: "desc",
                },
                select:{
                    id:true,
                    shopName:true,
                    shopImage:true,
                    Address:true,
                    Tags:true,
                    Description:true,
                    ShopOpenStatus:true,
                    status:true,
                    Verified:true,
                    billingStatus:true,
                    slug:true,
                    MinimumDeliveryRate:true,
                    FreeDeliveryRate:true,
                    latitude:true,
                    longitude:true,
                    createdAt:true,
                    updatedAt:true
                }
            },
            createdAt: true,
            updatedAt: true,
        },
    });
    if(!seller) throw new apiError(401,"seller not found or please login again")
        
    if (!seller || seller.isBlocked) {
        throw new apiError(401, "User blocked or unauthorized");
    }

    if (seller.role !== "SELLER") {
        throw new apiError(403, "Seller access required");
    }

    return res
        .status(200)
        .json(new apiResponse(200, seller, "Seller profile fetched successfully"));
});

const updateSellerProfile = asyncHandler(async (req, res) => {
    const userId = req.params.userId || req.userData?.id;
    const requesterId = req.userData?.id;

    if (!userId || !requesterId) {
        throw new apiError(401, "Unauthorized user");
    }

    const updateData = {};

    sellerEditableFields.forEach((field) => {
        if (req.body[field] !== undefined) {
            updateData[field] = field === "latitude" || field === "longitude"
                ? req.body[field]
                : String(req.body[field]).trim();
        }
    });

    if (updateData.latitude !== undefined) {
        updateData.latitude = parseCoordinate(updateData.latitude, "latitude");
    }

    if (updateData.longitude !== undefined) {
        updateData.longitude = parseCoordinate(updateData.longitude, "longitude");
    }

    if (!Object.keys(updateData).length) {
        throw new apiError(400, "No valid seller fields received");
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

    if (currentUser.role !== "ADMIN" && currentUser.role !== "SELLER") {
        throw new apiError(403, "Admin or seller access required");
    }

    if (currentUser.role === "SELLER" && userId !== requesterId) {
        throw new apiError(403, "You can only edit your own seller profile");
    }

    const existingSeller = await prisma.user.findUnique({
        where:{
            id:userId
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if (!existingSeller || existingSeller.isBlocked) {
        throw new apiError(404, "seller not found or blocked");
    }

    if (existingSeller.role !== "SELLER") {
        throw new apiError(403, "Target user is not a seller");
    }

    const seller = await prisma.user.update({
        where: {
            id: userId,
        },
        data: updateData,
        select:sellerProfileSelect,
    });

    return res
        .status(200)
        .json(new apiResponse(200, seller, "Seller profile updated successfully"));
});

const deleteSeller = asyncHandler(async (req, res) => {
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
        .json(new apiResponse(200, null, "Seller deleted successfully"));
});

export { createSeller, createSellerByAdmin, getSellerProfile, updateSellerProfile, deleteSeller };
