import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { threadCpuUsage } from "process";

const userEditableFields = [
    "email",
    "name",
    "phone",
    "latitude",
    "longitude",
    "profileImg",
];

const adminEditableFields = [
    ...userEditableFields,
    "role",
    "isVerified",
    "isBlocked",
];

const userRoles = ["SUPER", "BUYER", "SELLER", "ADMIN"];
const selfAssignableRoles = ["BUYER", "SELLER"];

const normalizeRole = (role) => typeof role === "string" ? role.toUpperCase() : role;

const getPaginationSkip = (req) => {
    const skip = Number(req.query.skip || 0);
    if(Number.isNaN(skip) || skip < 0) throw new apiError(400,"Invalid skip value");
    return skip;
};

// admin
const fetchAllUsers = asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
        orderBy: {
            createdAt: "desc",
        },
    });

    return res
        .status(200)
        .json(new apiResponse(200, users, "Users fetched successfully"));
});


const fetchUserProfile = asyncHandler(async (req, res) => {
    const id = req.userData?.id;

    if (!id) {
        throw new apiError(401, "Unauthorized user");
    }

    const user = await prisma.user.findUnique({
        where: {
            id,
        },
    });

    if (!user || user.isBlocked) {
        throw new apiError(401, "User blocked or unauthorized");
    }

    return res
        .status(200)
        .json(new apiResponse(200, user, "User profile fetched successfully"));
});

// admin
const deleteUser = asyncHandler(async (req, res) => {
    const id = req.params.userId;

    if (!id) {
        throw new apiError(400, "Invalid user id");
    }

    const existingUser = await prisma.user.findUnique({
        where: {
            id,
        },
        select: {
            id: true,
        },
    });

    if (!existingUser) {
        throw new apiError(404, "User not found");
    }

    const isDeleted = await prisma.user.delete({
        where: {
            id,
        },
    });
if(!isDeleted) throw new apiError(400,"user deletion error")
    return res
        .status(200)
        .json(new apiResponse(200, null, "User deleted successfully"));
});

// admin
const editUserData = asyncHandler(async (req, res) => {
    const id = req.params.userId;

    if (!id) {
        throw new apiError(400, "Invalid user id");
    }

    const isAdminUser = req.currentUser?.role === "ADMIN";
    const allowedFields = isAdminUser ? adminEditableFields : userEditableFields;

    const updateData = {};

    allowedFields.forEach((field) => {
        if (req.body[field] !== undefined) {
            updateData[field] = req.body[field];
        }
    });

    if (updateData.role !== undefined) {
        updateData.role = normalizeRole(updateData.role);
    }

    if (!isAdminUser && req.body.role !== undefined) {
        const requestedRole = normalizeRole(req.body.role);

        if (requestedRole === "ADMIN" || requestedRole === "SUPER") {
            throw new apiError(403, "Only admins can assign admin role");
        }

        if (!selfAssignableRoles.includes(requestedRole)) {
            throw new apiError(400, "Invalid user role");
        }

        updateData.role = requestedRole;
    }

    if (updateData.role !== undefined && !userRoles.includes(updateData.role)) {
        throw new apiError(400, "Invalid user role");
    }

    if (!Object.keys(updateData).length) {
        throw new apiError(400, "No valid user fields received");
    }

    const existingUser = await prisma.user.findUnique({
        where: {
            id,
        },
        select: {
            id: true,
        },
    });

    if (!existingUser) {
        throw new apiError(404, "User not found");
    }

    const user = await prisma.user.update({
        where: {
            id,
        },
        data: updateData,
    });

    return res
        .status(200)
        .json(new apiResponse(200, user, "User updated successfully"));
});

const editOwnUserData = asyncHandler(async (req, res) => {
    const id = req.userData?.id;

    if (!id) {
        throw new apiError(401, "Unauthorized user");
    }

    const currentUser = await prisma.user.findUnique({
        where: {
            id,
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

    if (!selfAssignableRoles.includes(currentUser.role)) {
        throw new apiError(403, "Only buyers and sellers can edit their own data here");
    }

    const updateData = {};

    userEditableFields.forEach((field) => {
        if (req.body[field] !== undefined) {
            updateData[field] = req.body[field];
        }
    });

    const avatarFilePath = req.files?.avatar?.[0]?.path;
        // if(!avatarFilePath) console.warn("No files found from user")


    if (avatarFilePath) {
        const uploadStatus = await cloudUploader(avatarFilePath);

        if (!uploadStatus?.url) {
            throw new apiError(400, "Avatar upload failed");
        }

        updateData.profileImg = uploadStatus.url;
    }

    if (!Object.keys(updateData).length) {
        throw new apiError(400, "No valid user fields or avatar received");
    }

    const user = await prisma.user.update({
        where: {
            id,
        },
        data: updateData,
    });

    return res
        .status(200)
        .json(new apiResponse(200, user, "User data updated successfully"));
});
// admin
const SuspendUser = asyncHandler(async (req, res) => {
    const id = req.params.userId;

    if (!id) {
        throw new apiError(400, "Invalid user id");
    }

    const existingUser = await prisma.user.findUnique({
        where: {
            id,
        },
        select: {
            id: true,
        },
    });

    if (!existingUser) {
        throw new apiError(404, "User not found");
    }

    const user = await prisma.user.update({
        where: {
            id,
        },
        data: {
            isBlocked: true,
        },
    });

    return res
        .status(200)
        .json(new apiResponse(200, user, "User suspended successfully"));
});
// admin
const fetchAllSellers = asyncHandler(async(req,res)=>{
    const skip = getPaginationSkip(req);

    const allData = await prisma.user.findMany({
        where:{
            role:"SELLER"
        },
        skip,
        take:10,
        orderBy:{
            createdAt:"asc"
        }
    })
    if(!allData) throw new apiError(400,"sellers fetching failed")
    return res.json(new apiResponse(200,allData,"All sellers fetched"))
})
// admin
const fetchAllBuyers= asyncHandler(async(req,res)=>{
    const skip = getPaginationSkip(req);

    const allData = await prisma.user.findMany({
        where:{
            role:"BUYER"
        },
        skip,
        take:10,
        orderBy:{
            createdAt:"asc"
        }
    })

    if(!allData) throw new apiError(400,"buyers fetching failed")
    return res.json(new apiResponse(200,allData,"All buyers fetched"))
})


export { fetchAllUsers, fetchUserProfile, deleteUser, editUserData, editOwnUserData, SuspendUser ,fetchAllSellers,fetchAllBuyers};
