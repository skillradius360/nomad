import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";

const parseShopId = (shopId) => {
    const id = Number(shopId);

    if (!Number.isInteger(id) || id <= 0) {
        throw new apiError(400, "Invalid shop id");
    }

    return id;
};

const parseRechargeAmount = (amount) => {
    const parsedAmount = Number(amount);

    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
        throw new apiError(400, "Invalid recharge amount");
    }

    return parsedAmount;
};

const parseOptionalCoordinate = (value, fieldName) => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const coordinate = Number(value);

    if (!Number.isFinite(coordinate)) {
        throw new apiError(400, `${fieldName} must be a valid number`);
    }

    return coordinate;
};

const rechargeListInclude = {
    user: {
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
        },
    },
    shop: {
        select: {
            id: true,
            shopName: true,
            shopBalance: true,
            Verified: true,
        },
    },
};

const createShop = asyncHandler(async(req,res)=>{

    const {shopName,description,
        latitude, longitude,shopCategory}= req.body
        const ownerId = req.userData?.id;

        if (!ownerId) {
            throw new apiError(401, "Unauthorized user");
        }

        if(!(shopName && description )){
            throw new apiError(400,"shop details missing for updation")
        }

        const shopImg = req.files?.shopimg?.[0]?.path
        if(!shopImg){
            throw new apiError(400,"shop image not provided")
        }

        const shopImage =await cloudUploader(shopImg)
        if(!shopImage.url) throw new apiError(400,"shop image uploading failed")
            
        const shopData = await prisma.shop.create({
            data: {
        shopName,
        ownerId,
        shopImage:shopImage.url,
        Description:description,
        // OpeningTime: new Date(openingTime),
        // ClosingTime: new Date(closingTime),
        Verified:false,
        latitude: parseOptionalCoordinate(latitude, "latitude"),
        longitude: parseOptionalCoordinate(longitude, "longitude"),
        shopCategory:shopCategory
    },
    });

    if(!shopData) throw new apiError(400," shop data creation process failed failed! ")

    return res.json(new apiResponse(200,shopData,"shop creation consent send and updated in Database"))
})


const createShopByAdmin = asyncHandler(async(req,res)=>{

    const access = req.currentUser.role
    if(access!="ADMIN")throw new  apiError(401,"Admin access required")

        const {shopName,description,
        latitude, longitude,shopCategory}= req.body
        const ownerId = req.userData?.id;

        if (!ownerId) {
            throw new apiError(401, "Unauthorized user");
        }

        if(!(shopName && description )){
            throw new apiError(400,"shop details missing for updation")
        }

        const shopImg = req.files?.shopimg?.[0]?.path
        if(!shopImg){
            throw new apiError(400,"shop image not provided")
        }

        const shopImage =await cloudUploader(shopImg)
        if(!shopImage.url) throw new apiError(400,"shop image uploading failed")
            
        const shopData = await prisma.shop.create({
            data: {
        shopName,
        ownerId,
        shopImage:shopImage.url,
        Description:description,
        // OpeningTime: new Date(openingTime),
        // ClosingTime: new Date(closingTime),
        Verified:false,
        latitude: parseOptionalCoordinate(latitude, "latitude"),
        longitude: parseOptionalCoordinate(longitude, "longitude"),
        shopCategory:shopCategory
    },
    });

    if(!shopData) throw new apiError(400," shop data creation process failed failed! ")

    return res.json(new apiResponse(200,shopData,"shop creation done by a admin"))

})

// ADMIN
const makeSellerGoLive = asyncHandler(async (req, res) => {
    const id = parseShopId(req.params.shopId);

    const shopData = await prisma.shop.update({
        where: {
            id,
        },
        data: {
            Verified: true,
        },
    });

    if(!shopData) throw new apiError(400,"new seller invocation failure")
    return res
        .status(200)
        .json(new apiResponse(200, shopData, "Seller creation verified successfully"));
});

// ADMIN
const deleteSeller = asyncHandler(async (req, res) => {
    const id = parseShopId(req.params.shopId);

    const delStatus = await prisma.shop.delete({
        where: {
            id,
        },
    });
    if(!delStatus) throw new apiError(400,"Revoking of target seller failed")
    return res
        .status(200)
        .json(new apiResponse(200, null, "Seller creation revoked successfully"));
});


// ************************************************************************************************


const createRecharge = asyncHandler(async(req,res)=>{
    const amount = parseRechargeAmount(req.body.amount)
    const userId = req.userData?.id;

    if (!userId) {
        throw new apiError(403, "You need to login first");
    }

    const user = await prisma.user.findUnique({
        where: {
            id: userId,
        },
        select: {
            id: true,
            isVerified: true,
            isBlocked: true,
        },
    });

    if (!user || !user.isVerified || user.isBlocked) {
        throw new apiError(400, "user potentially blocked from recharging");
    }

    const shopInfo = await prisma.shop.findFirst({
        where:{
            ownerId:userId,
        }
        ,select:{
            id:true,
            shopName:true,
            Verified:true,
        }
    })

    if (!shopInfo) {
        throw new apiError(404, "Shop not found for this user");
    }

    const createInstance = await prisma.recharges.create({
        data:{
            userId,
            shopId:shopInfo.id,
            orderAmount:amount,
            status:"PENDING"
        }
    })
    if(!createInstance) throw new apiError(400," recharging failure occured! ")

    return res
        .status(201)
        .json(new apiResponse(201, createInstance, "Recharge Request Created"))
})

const approveRecharge = asyncHandler(async (req, res) => {
    const { rechargeId } = req.params;

    if (!rechargeId) {
        throw new apiError(400, "Recharge id is required");
    }

    const result = await prisma.$transaction(async (tx) => {
        const recharge = await tx.recharges.findUnique({
            where: {
                id: rechargeId,
            },
        });

        if (!recharge) {
            throw new apiError(404, "Recharge request not found");
        }

        if (recharge.status !== "PENDING") {
            throw new apiError(409, "Recharge request is already processed");
        }

        const updatedRecharge = await tx.recharges.update({
            where: {
                id: rechargeId,
            },
            data: {
                status: "APPROVED",
            },
        });
    if(!updatedRecharge) throw new apiError(400,"recharge status updation failed")

        const updatedShop = await tx.shop.update({
            where: {
                id: recharge.shopId,
            },
            data: {
                shopBalance: {
                    increment: recharge.orderAmount,
                },
            },
        });
        if(!updatedShop) throw new apiError(400,"shop balance updation error")
            const userInfo = await tx.user.findUnique({
        where:{
            id:recharge.userId
        },
        select:{
            billingPlan:true,
            isVerified:true
        }
    })
    if(!userInfo) throw new apiError(400,"transaction target user fetching failed")

        if(userInfo.billingPlan=="TRIAL"){
            const userInfo = await tx.user.update({
            where:{
                id:recharge.userId
            },
            data:{
                billingPlan:"ACTIVE"
            }
        })
        }
        return {
            recharge: updatedRecharge,
            shop: updatedShop,
        };
    });

    return res
        .status(200)
        .json(new apiResponse(200, result, "Recharge approved and shop balance updated"));
});

const getPendingRecharges = asyncHandler(async (req, res) => {
    if(!req.userData.id) throw new apiError(400,"user not logged in")
    const pendingRecharges = await prisma.recharges.findMany({
        where: {
            status: "PENDING",
        },
        include: {
    user: {
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
        },
    },
    shop: {
        select: {
            id: true,
            shopName: true,
            shopBalance: true,
            Verified: true,
        },
    },
},
        orderBy: {
            createdAt: "desc",
        },
    });
    if(!pendingRecharges) throw new apiError(400,"pending based recharges fetching  failure!!")
    return res
        .status(200)
        .json(new apiResponse(200, pendingRecharges, "Pending recharge requests fetched successfully"));
});

const getAllRecharges = asyncHandler(async (req, res) => {
        if(!req.userData.id) throw new apiError(400,"user not logged in")
    const recharges = await prisma.recharges.findMany({
        include: {
    user: {
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
        },
    },
    shop: {
        select: {
            id: true,
            shopName: true,
            shopBalance: true,
            Verified: true,
        },
    },
},
        orderBy: {
            createdAt: "desc",
        },
    });
    if(!recharges) throw new apiError(400,"all recharges fetching failure!!")
    return res
        .status(200)
        .json(new apiResponse(200, recharges, "Recharge requests fetched successfully"));
});

export {
    createShop,
    makeSellerGoLive,
    deleteSeller,
    createShopByAdmin,



    createRecharge,
    approveRecharge,
    getPendingRecharges,
    getAllRecharges,
};
