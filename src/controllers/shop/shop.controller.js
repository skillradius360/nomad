import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { getCachedData, setCachedData } from "../../utils/cache.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";

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

const isTruthyQuery = (value) => ["true", "1", "yes", "on"].includes(String(value).trim().toLowerCase());

const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;

const parseTrialDays = (value) => {
    const trialDays = Number(value);

    if (!Number.isInteger(trialDays) || trialDays <= 0) {
        throw new apiError(400, "trialDays must be a positive whole number");
    }

    return trialDays;
};

const addDays = (date, days) => new Date(date.getTime() + (days * MILLISECONDS_IN_DAY));

const buildTrialState = (shop) => {
    const now = new Date();
    const trialEndsAt = shop.trialEndsAt ? new Date(shop.trialEndsAt) : null;
    const paymentRequired = shop.billingStatus === "PAYMENT_DUE" || Boolean(trialEndsAt && now >= trialEndsAt);
    const remainingMilliseconds = trialEndsAt ? Math.max(0, trialEndsAt.getTime() - now.getTime()) : null;

    return {
        billingStatus: paymentRequired ? "PAYMENT_DUE" : shop.billingStatus,
        trialStartedAt: shop.trialStartedAt,
        trialDays: shop.trialDays,
        trialEndsAt: shop.trialEndsAt,
        trialDaysRemaining: remainingMilliseconds === null ? null : Math.ceil(remainingMilliseconds / MILLISECONDS_IN_DAY),
        paymentRequired,
    };
};

const formatShopBrowseItem = (shopItem)=>({
    id:shopItem.id,
    itemId:shopItem.item?.id,
    name:shopItem.item?.name,
    pricing:shopItem.pricing,
    finalPrice:Math.max(0,Math.round(Number(shopItem.pricing))),
    availableQuantity:shopItem.availableQuantity,
    imageUrl:shopItem.imageUrl || shopItem.item?.imageUrl || null,
    description:shopItem.description,
    sortOrderId:shopItem.sortOrderId,
    active:shopItem.active,
    categoryId:shopItem.item?.categoryId || null,
    categoryName:shopItem.item?.category?.name || null,
    cuisineId:shopItem.item?.category?.cuisineId || null
});

const formatShopBrowseCombo = (combo)=>({
    id:combo.id,
    name:combo.name,
    description:combo.description,
    imageUrl:combo.imageUrl,
    totalPrice:combo.totalPrice,
    availableQuantity:combo.availableQuantity,
    sortOrderId:combo.sortOrderId,
    active:combo.active,
    cuisineId:combo.cuisine?.id || null,
    cuisineName:combo.cuisine?.name || null,
    categoryId:combo.category?.id || null,
    categoryName:combo.category?.name || null,
    items:combo.items?.map((comboItem)=>({
        id:comboItem.item?.id,
        comboItemId:comboItem.id,
        itemId:comboItem.item?.item?.id,
        name:comboItem.item?.item?.name,
        quantity:comboItem.quantity,
        pricing:comboItem.item?.pricing,
        finalPrice:Math.max(0,Math.round(Number(comboItem.item?.pricing))),
        imageUrl:comboItem.item?.imageUrl || comboItem.item?.item?.imageUrl || null,
        description:comboItem.item?.description,
        categoryId:comboItem.item?.item?.categoryId || null
    })) || []
});

const formatShopBrowseData = (shopData)=>({
    ...shopData,
    trial:buildTrialState(shopData),
    shopType:shopData.shopType ? {
        id:shopData.shopType.id,
        name:shopData.shopType.name,
        slug:shopData.shopType.slug,
        features:shopData.shopType.features?.map((feature)=>feature.feature) || []
    } : null,
    items:shopData.items?.map(formatShopBrowseItem) || [],
    combos:shopData.combos?.map(formatShopBrowseCombo) || []
});

const formatFullShopData = (shop)=>{
    const openState = calculateShopOpenState(shop);

    return {
        id:shop.id,
        shopName:shop.shopName,
        shopImage:shop.shopImage,
        address:shop.Address,
        tags:shop.Tags,
        description:shop.Description,
        slug:shop.slug,
        verified:shop.Verified,
        shopType:shop.shopType,
        delivery:{
            minimumRate:shop.MinimumDeliveryRate,
            freeRate:shop.FreeDeliveryRate
        },
        location:{
            latitude:shop.latitude,
            longitude:shop.longitude
        },
        owner:shop.owner,
        configuredStatus:openState.configuredStatus,
        openStatus:openState.openStatus,
        isOpenNow:openState.isOpenNow,
        todayTiming:openState.todayTiming,
        timings:shop.timings,
        items:shop.items,
        combos:shop.combos
    };
};

const validShopStatuses = ["OPEN", "CLOSED", "AUTOMATIC"];
const validShopDays = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];

const parseShopStatus = (value) => {
    const status = String(value || "").trim().toUpperCase();

    if(!validShopStatuses.includes(status)){
        throw new apiError(400,"status must be OPEN, CLOSED, or AUTOMATIC");
    }

    return status;
};

const calculateShopOpenState = (shop, now = new Date()) => {
    const configuredStatus = shop.status || shop.ShopOpenStatus || "AUTOMATIC";
    const currentDay = validShopDays[now.getDay() === 0 ? 6 : now.getDay() - 1];
    const currentMinute = (now.getHours() * 60) + now.getMinutes();
    let isOpenNow = false;
    let todayTiming = null;

    if(configuredStatus === "OPEN"){
        isOpenNow = true;
    }else if(configuredStatus === "CLOSED"){
        isOpenNow = false;
    }else{
        todayTiming = shop.timings?.find((timing)=>timing.dayOfWeek === currentDay && timing.active) || null;

        if(todayTiming){
            isOpenNow = todayTiming.startMinute <= todayTiming.endMinute
                ? currentMinute >= todayTiming.startMinute && currentMinute <= todayTiming.endMinute
                : currentMinute >= todayTiming.startMinute || currentMinute <= todayTiming.endMinute;
        }else if(shop.OpeningTime && shop.ClosingTime && !shop.Holidays?.includes(currentDay.toLowerCase())){
            const opening = new Date(shop.OpeningTime);
            const closing = new Date(shop.ClosingTime);
            const openingMinute = (opening.getHours() * 60) + opening.getMinutes();
            const closingMinute = (closing.getHours() * 60) + closing.getMinutes();

            isOpenNow = openingMinute <= closingMinute
                ? currentMinute >= openingMinute && currentMinute <= closingMinute
                : currentMinute >= openingMinute || currentMinute <= closingMinute;
        }
    }

    return {
        configuredStatus,
        openStatus:isOpenNow ? "OPEN" : "CLOSED",
        isOpenNow,
        currentDay,
        currentMinute,
        todayTiming
    };
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
            billingStatus: true,
            trialStartedAt: true,
            trialDays: true,
            trialEndsAt: true,
        },
    },
};
function generateRandom(length = 4) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
const createShop = asyncHandler(async(req,res)=>{

    const {shopName,description,
        latitude, longitude,shopTypeId,shopTypeSlug}= req.body
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
        
        const createSlug = await shopName.charAt(0)+shopName.charAt(1)+generateRandom(4)
        if(!createSlug.length>5) throw new apiError(400,"slug creation error")

        let selectedShopType = null;
        if(shopTypeId || shopTypeSlug){
            selectedShopType = await prisma.shopType.findFirst({
                where:shopTypeId ? {
                    id:shopTypeId,
                    active:true
                } : {
                    slug:String(shopTypeSlug).trim().toUpperCase(),
                    active:true
                },
                select:{
                    id:true
                }
            });

            if(!selectedShopType) throw new apiError(404,"shop type not found");
        }

        const shopData = await prisma.shop.create({
            data: {
        shopName,
        ownerId,
        shopImage:shopImage.url,
        Description:description,
        slug:createSlug,
        OpeningTime:null,
        ClosingTime:null,
        ShopOpenStatus:"CLOSED",
        status:"CLOSED",
        Holidays:validShopDays.map((day)=>day.toLowerCase()),
        Verified:req.currentUser?.role === "ADMIN",
        latitude: parseOptionalCoordinate(latitude, "latitude"),
        longitude: parseOptionalCoordinate(longitude, "longitude"),
        shopTypeId:selectedShopType?.id
    },
    select:{
        id:true,
        shopName:true,
        shopImage:true,
        Description:true,
        slug:true,
        ShopOpenStatus:true,
        status:true,
        Verified:true,
        shopType:{
            select:{
                id:true,
                name:true,
                slug:true,
                features:{
                    where:{enabled:true},
                    select:{feature:true}
                }
            }
        },
        timings:{
            orderBy:{
                dayOfWeek:"asc"
            }
        }
    }
    });

    if(!shopData) throw new apiError(400," shop data creation process failed failed! ")

    return res.json(new apiResponse(200,{
        id:shopData.id,
        shopName:shopData.shopName,
        shopImage:shopData.shopImage,
        slug:shopData.slug,
        verified:shopData.Verified,
        status:shopData.status,
        shopType:shopData.shopType ? {
            id:shopData.shopType.id,
            name:shopData.shopType.name,
            slug:shopData.shopType.slug,
            features:shopData.shopType.features.map((feature)=>feature.feature)
        } : null
    },"shop creation consent send and updated in Database"))
})


// ADMIN
const makeSellerGoLive = asyncHandler(async (req, res) => {
    const id = req.params.shopId;

    if(!id) throw new apiError(400,"shop id is required");

    const existingShop = await prisma.shop.findUnique({
        where:{
            id
        },
        select:{
            id:true
        }
    });

    if(!existingShop) throw new apiError(404,"shop not found");

    const shopData = await prisma.shop.update({
        where: {
            id,
        },
        data: {
            Verified: true,
        },
        select:{
            id:true,
            shopName:true,
            Verified:true
        }
    });

    if(!shopData) throw new apiError(400,"new seller invocation failure")
    return res
        .status(200)
        .json(new apiResponse(200, {
            id:shopData.id,
            shopName:shopData.shopName,
            verified:shopData.Verified
        }, "Seller creation verified successfully"));
});

// ADMIN
const deleteSeller = asyncHandler(async (req, res) => {
    const id = req.params.shopId;

    if(!id) throw new apiError(400,"shop id is required");

    const existingShop = await prisma.shop.findUnique({
        where:{
            id
        },
        select:{
            id:true
        }
    });

    if(!existingShop) throw new apiError(404,"shop not found");

    const delStatus = await prisma.shop.delete({
        where: {
            id,
        },
        select:{
            id:true,
            shopName:true
        }
    });
    if(!delStatus) throw new apiError(400,"Revoking of target seller failed")
    return res
        .status(200)
        .json(new apiResponse(200, delStatus, "Seller creation revoked successfully"));
});

const findFullShopData = asyncHandler(async(req,res)=>{
    const shopId  = req.params.shopId

    if(!shopId) throw new apiError(400," shopId is not passed!")

    const cacheKey = `buyer:shop:full:v3:${shopId}`;
    const cachedShop = await getCachedData(cacheKey);
    if(cachedShop){
        return res.status(200).json(new apiResponse(200,cachedShop,"full shop data fetched"));
    }

    const [shopData] = await prisma.$queryRaw`
        SELECT
            s.id,
            s."shopName",
            s."shopImage",
            s."Address",
            s."Tags",
            s."Description",
            s.slug,
            s."OpeningTime",
            s."ClosingTime",
            s."ShopOpenStatus",
            s.status,
            s."Holidays",
            s."Verified",
            s."MinimumDeliveryRate",
            s."FreeDeliveryRate",
            s.latitude,
            s.longitude,
            CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id',st.id,
                'name',st.name,
                'slug',st.slug,
                'features',COALESCE((
                    SELECT jsonb_agg(stf.feature ORDER BY stf.feature)
                    FROM "ShopTypeFeature" stf
                    WHERE stf."shopTypeId" = st.id AND stf.enabled = true
                ),'[]'::jsonb)
            ) END AS "shopType",
            jsonb_build_object('id',u.id,'name',u.name,'profileImg',u."profileImg") AS owner,
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'dayOfWeek',timing."dayOfWeek",
                    'startMinute',timing."startMinute",
                    'endMinute',timing."endMinute",
                    'active',timing.active
                ) ORDER BY timing."dayOfWeek")
                FROM "ShopTiming" timing
                WHERE timing."shopId" = s.id
            ),'[]'::jsonb) AS timings,
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id',si.id,
                    'itemId',i.id,
                    'name',i.name,
                    'pricing',si.pricing,
                    'availableQuantity',si."availableQuantity",
                    'imageUrl',COALESCE(si."imageUrl",i."imageUrl"),
                    'description',si.description,
                    'category',CASE WHEN category.id IS NULL THEN NULL ELSE jsonb_build_object(
                        'id',category.id,
                        'name',category.name,
                        'cuisineId',category."cuisineId"
                    ) END
                ) ORDER BY si."sortOrderId")
                FROM "ShopItem" si
                JOIN "Items" i ON i.id = si."itemId"
                LEFT JOIN "Categories" category ON category.id = i."categoryId"
                WHERE si."shopId" = s.id AND si.active = true
            ),'[]'::jsonb) AS items,
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id',combo.id,
                    'name',combo.name,
                    'description',combo.description,
                    'imageUrl',combo."imageUrl",
                    'totalPrice',combo."totalPrice",
                    'availableQuantity',combo."availableQuantity",
                    'cuisine',CASE WHEN cuisine.id IS NULL THEN NULL ELSE jsonb_build_object('id',cuisine.id,'name',cuisine.name) END,
                    'category',CASE WHEN combo_category.id IS NULL THEN NULL ELSE jsonb_build_object('id',combo_category.id,'name',combo_category.name) END,
                    'items',COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'id',combo_shop_item.id,
                            'itemId',master_item.id,
                            'name',master_item.name,
                            'quantity',combo_item.quantity,
                            'pricing',combo_shop_item.pricing,
                            'imageUrl',COALESCE(combo_shop_item."imageUrl",master_item."imageUrl")
                        ))
                        FROM "ComboItem" combo_item
                        JOIN "ShopItem" combo_shop_item ON combo_shop_item.id = combo_item."itemId"
                        JOIN "Items" master_item ON master_item.id = combo_shop_item."itemId"
                        WHERE combo_item."comboId" = combo.id
                    ),'[]'::jsonb)
                ) ORDER BY combo."sortOrderId")
                FROM "Combo" combo
                LEFT JOIN "Cuisine" cuisine ON cuisine.id = combo."cuisineId"
                LEFT JOIN "Categories" combo_category ON combo_category.id = combo."categoryId"
                WHERE combo."shopId" = s.id AND combo.active = true
            ),'[]'::jsonb) AS combos
        FROM "Shop" s
        LEFT JOIN "User" u ON u.id = s."ownerId"
        LEFT JOIN "ShopType" st ON st.id = s."shopTypeId"
        WHERE s.id = ${shopId}
        LIMIT 1
    `;

    if(!shopData) throw new apiError(404,"The shop details failed to fetch")

    const responseData = formatFullShopData(shopData);
    void setCachedData(cacheKey,responseData,60);

    return res.status(200).json(new apiResponse(200,responseData,"full shop data fetched"))
})

// ADMIN
const setShopTrialPeriod = asyncHandler(async(req,res)=>{
    const {shopId} = req.params;
    const trialDays = parseTrialDays(req.body.trialDays ?? req.body.days);

    if(!shopId) throw new apiError(400,"shop id is required");

    const existingShop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            trialStartedAt:true,
            createdAt:true
        }
    });

    if(!existingShop) throw new apiError(404,"shop not found");

    const requestedStartDate = req.body.trialStartedAt || req.body.startsAt;
    const trialStartedAt = requestedStartDate ? new Date(requestedStartDate) : (existingShop.trialStartedAt || existingShop.createdAt);

    if(Number.isNaN(trialStartedAt.getTime())){
        throw new apiError(400,"trialStartedAt must be a valid date");
    }

    const trialEndsAt = addDays(trialStartedAt,trialDays);
    const billingStatus = new Date() >= trialEndsAt ? "PAYMENT_DUE" : "TRIAL";

    const shopData = await prisma.shop.update({
        where:{
            id:shopId
        },
        data:{
            trialStartedAt,
            trialDays,
            trialEndsAt,
            billingStatus
        },
        select:{
            id:true,
            shopName:true,
            billingStatus:true,
            trialStartedAt:true,
            trialDays:true,
            trialEndsAt:true
        }
    });

    return res
        .status(200)
        .json(new apiResponse(200,{
            id:shopData.id,
            shopName:shopData.shopName,
            billingStatus:shopData.billingStatus,
            trial:buildTrialState(shopData)
        },"shop trial period updated successfully"));
})


const setShopTimings = asyncHandler(async(req,res)=>{
    const {shopId} = req.params;
    const {openingTime,closingTime,openDays,timings,shopOpenStatus} = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");

    const existingShop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true
        }
    });

    if(!existingShop) throw new apiError(404,"shop not found");

    if(req.currentUser?.role !== "ADMIN" && existingShop.ownerId !== req.userData?.id){
        throw new apiError(403,"you are not allowed to update this shop timing");
    }

    const timingPayload = Array.isArray(timings) && timings.length
        ? timings
        : Array.isArray(openDays) && openDays.length
            ? openDays.map((day)=>({
                dayOfWeek:day,
                openingTime,
                closingTime
            }))
            : [];

    if(!timingPayload.length){
        throw new apiError(400,"timings or openDays with openingTime and closingTime is required");
    }

    const parsedTimings = [];
    let defaultOpeningTime = null;
    let defaultClosingTime = null;

    for(const timing of timingPayload){
        const dayOfWeek = String(timing.dayOfWeek || timing.day || "").trim().toUpperCase();
        if(!validShopDays.includes(dayOfWeek)){
            throw new apiError(400,`${dayOfWeek || "day"} is not a valid shop open day`);
        }

        const rawOpeningTime = String(timing.openingTime || timing.openTime || timing.startTime || "").trim().toLowerCase().replace(/\s+/g,"");
        const rawClosingTime = String(timing.closingTime || timing.closeTime || timing.endTime || "").trim().toLowerCase().replace(/\s+/g,"");
        const openingMatch = rawOpeningTime.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
        const closingMatch = rawClosingTime.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);

        if(!openingMatch || !closingMatch){
            throw new apiError(400,"openingTime and closingTime must be valid values like 09:00, 9:30am, 18:00");
        }

        let openingHour = Number(openingMatch[1]);
        const openingMinute = openingMatch[2] === undefined ? 0 : Number(openingMatch[2]);
        const openingMeridiem = openingMatch[3];
        let closingHour = Number(closingMatch[1]);
        const closingMinute = closingMatch[2] === undefined ? 0 : Number(closingMatch[2]);
        const closingMeridiem = closingMatch[3];

        if(openingMinute > 59 || closingMinute > 59){
            throw new apiError(400,"time minute must be between 0 and 59");
        }
        if(openingMeridiem){
            if(openingHour < 1 || openingHour > 12) throw new apiError(400,"openingTime hour is invalid");
            if(openingMeridiem === "pm" && openingHour !== 12) openingHour += 12;
            if(openingMeridiem === "am" && openingHour === 12) openingHour = 0;
        }else if(openingHour < 0 || openingHour > 23){
            throw new apiError(400,"openingTime hour is invalid");
        }
        if(closingMeridiem){
            if(closingHour < 1 || closingHour > 12) throw new apiError(400,"closingTime hour is invalid");
            if(closingMeridiem === "pm" && closingHour !== 12) closingHour += 12;
            if(closingMeridiem === "am" && closingHour === 12) closingHour = 0;
        }else if(closingHour < 0 || closingHour > 23){
            throw new apiError(400,"closingTime hour is invalid");
        }

        parsedTimings.push({
            dayOfWeek,
            startMinute:(openingHour * 60) + openingMinute,
            endMinute:(closingHour * 60) + closingMinute,
            active:timing.active === undefined ? true : Boolean(timing.active)
        });

        if(!defaultOpeningTime){
            defaultOpeningTime = new Date();
            defaultOpeningTime.setHours(openingHour,openingMinute,0,0);
            defaultClosingTime = new Date();
            defaultClosingTime.setHours(closingHour,closingMinute,0,0);
        }
    }

    const duplicateDay = parsedTimings.find((timing,index)=>parsedTimings.findIndex((current)=>current.dayOfWeek === timing.dayOfWeek) !== index);
    if(duplicateDay){
        throw new apiError(400,`${duplicateDay.dayOfWeek} timing is repeated`);
    }

    const shopStatus = shopOpenStatus ? parseShopStatus(shopOpenStatus) : "AUTOMATIC";

    const holidays = validShopDays
        .filter((day)=>!parsedTimings.some((timing)=>timing.dayOfWeek === day))
        .map((day)=>day.toLowerCase());

    const shopData = await prisma.shop.update({
        where:{
            id:shopId
        },
        data:{
            OpeningTime:defaultOpeningTime,
            ClosingTime:defaultClosingTime,
            Holidays:holidays,
            ShopOpenStatus:shopStatus,
            status:shopStatus,
            timings:{
                deleteMany:{},
                create:parsedTimings
            }
        },
        select:{
            id:true,
            shopName:true,
            Holidays:true,
            ShopOpenStatus:true,
            timings:{
                orderBy:{
                    dayOfWeek:"asc"
                },
                select:{
                    id:true,
                    dayOfWeek:true,
                    startMinute:true,
                    endMinute:true,
                    active:true
                }
            }
        }
    });

    return res.status(200).json(new apiResponse(200,{
        id:shopData.id,
        shopName:shopData.shopName,
        configuredStatus:shopData.ShopOpenStatus,
        holidays:shopData.Holidays,
        timings:shopData.timings
    },"shop timings updated successfully"));
})


const editShopSettings = asyncHandler(async(req,res)=>{
    const {shopId} = req.params;
    const {
        shopName,
        description,
        address,
        tags,
        shopTypeId,
        shopTypeSlug,
        shopOpenStatus,
        openingTime,
        closingTime,
        openDays,
        timings,
        minimumDeliveryRate,
        freeDeliveryRate,
        latitude,
        longitude
    } = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");

    const existingShop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true,
            shopImage:true
        }
    });

    if(!existingShop) throw new apiError(404,"shop not found");

    if(req.currentUser?.role !== "ADMIN" && existingShop.ownerId !== req.userData?.id){
        throw new apiError(403,"you are not allowed to edit this shop");
    }

    const dataToUpdate = {};

    if(shopName !== undefined){
        const updatedShopName = String(shopName).trim();
        if(!updatedShopName) throw new apiError(400,"shopName cannot be empty");
        dataToUpdate.shopName = updatedShopName;
    }

    if(description !== undefined) dataToUpdate.Description = String(description).trim();
    if(address !== undefined) dataToUpdate.Address = String(address).trim();
    if(tags !== undefined) dataToUpdate.Tags = Array.isArray(tags) ? tags.join(",") : String(tags).trim();
    if(shopTypeId !== undefined || shopTypeSlug !== undefined){
        if(shopTypeId === null || shopTypeId === "" || shopTypeSlug === null || shopTypeSlug === ""){
            dataToUpdate.shopTypeId = null;
        }else{
            const selectedShopType = await prisma.shopType.findFirst({
                where:shopTypeId !== undefined ? {
                    id:String(shopTypeId),
                    active:true
                } : {
                    slug:String(shopTypeSlug).trim().toUpperCase(),
                    active:true
                },
                select:{id:true}
            });

            if(!selectedShopType) throw new apiError(404,"shop type not found");
            dataToUpdate.shopTypeId = selectedShopType.id;
        }
    }
    if(latitude !== undefined) dataToUpdate.latitude = parseOptionalCoordinate(latitude,"latitude");
    if(longitude !== undefined) dataToUpdate.longitude = parseOptionalCoordinate(longitude,"longitude");

    if(minimumDeliveryRate !== undefined){
        const parsedMinimumDeliveryRate = Number(minimumDeliveryRate);
        if(!Number.isFinite(parsedMinimumDeliveryRate) || parsedMinimumDeliveryRate < 0){
            throw new apiError(400,"minimumDeliveryRate must be a valid positive number");
        }
        dataToUpdate.MinimumDeliveryRate = Math.round(parsedMinimumDeliveryRate);
    }

    if(freeDeliveryRate !== undefined){
        const parsedFreeDeliveryRate = Number(freeDeliveryRate);
        if(!Number.isFinite(parsedFreeDeliveryRate) || parsedFreeDeliveryRate < 0){
            throw new apiError(400,"freeDeliveryRate must be a valid positive number");
        }
        dataToUpdate.FreeDeliveryRate = Math.round(parsedFreeDeliveryRate);
    }

    const shopImg = req.files?.shopimg?.[0]?.path;
    if(shopImg){
        const shopImage = await cloudUploader(shopImg);
        if(!shopImage.url) throw new apiError(400,"shop image uploading failed");
        dataToUpdate.shopImage = shopImage.url;
    }

    if(shopOpenStatus !== undefined){
        const shopStatus = parseShopStatus(shopOpenStatus);
        dataToUpdate.ShopOpenStatus = shopStatus;
        dataToUpdate.status = shopStatus;
    }

    const shouldUpdateTimings = (Array.isArray(timings) && timings.length) || (Array.isArray(openDays) && openDays.length);

    if(shouldUpdateTimings){
        const timingPayload = Array.isArray(timings) && timings.length
            ? timings
            : openDays.map((day)=>({
                dayOfWeek:day,
                openingTime,
                closingTime
            }));
        const parsedTimings = [];
        let defaultOpeningTime = null;
        let defaultClosingTime = null;

        for(const timing of timingPayload){
            const dayOfWeek = String(timing.dayOfWeek || timing.day || "").trim().toUpperCase();
            if(!validShopDays.includes(dayOfWeek)){
                throw new apiError(400,`${dayOfWeek || "day"} is not a valid shop open day`);
            }

            const rawOpeningTime = String(timing.openingTime || timing.openTime || timing.startTime || "").trim().toLowerCase().replace(/\s+/g,"");
            const rawClosingTime = String(timing.closingTime || timing.closeTime || timing.endTime || "").trim().toLowerCase().replace(/\s+/g,"");
            const openingMatch = rawOpeningTime.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
            const closingMatch = rawClosingTime.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);

            if(!openingMatch || !closingMatch){
                throw new apiError(400,"openingTime and closingTime must be valid values like 09:00, 9:30am, 18:00");
            }

            let openingHour = Number(openingMatch[1]);
            const openingMinute = openingMatch[2] === undefined ? 0 : Number(openingMatch[2]);
            const openingMeridiem = openingMatch[3];
            let closingHour = Number(closingMatch[1]);
            const closingMinute = closingMatch[2] === undefined ? 0 : Number(closingMatch[2]);
            const closingMeridiem = closingMatch[3];

            if(openingMinute > 59 || closingMinute > 59){
                throw new apiError(400,"time minute must be between 0 and 59");
            }
            if(openingMeridiem){
                if(openingHour < 1 || openingHour > 12) throw new apiError(400,"openingTime hour is invalid");
                if(openingMeridiem === "pm" && openingHour !== 12) openingHour += 12;
                if(openingMeridiem === "am" && openingHour === 12) openingHour = 0;
            }else if(openingHour < 0 || openingHour > 23){
                throw new apiError(400,"openingTime hour is invalid");
            }
            if(closingMeridiem){
                if(closingHour < 1 || closingHour > 12) throw new apiError(400,"closingTime hour is invalid");
                if(closingMeridiem === "pm" && closingHour !== 12) closingHour += 12;
                if(closingMeridiem === "am" && closingHour === 12) closingHour = 0;
            }else if(closingHour < 0 || closingHour > 23){
                throw new apiError(400,"closingTime hour is invalid");
            }

            parsedTimings.push({
                dayOfWeek,
                startMinute:(openingHour * 60) + openingMinute,
                endMinute:(closingHour * 60) + closingMinute,
                active:timing.active === undefined ? true : Boolean(timing.active)
            });

            if(!defaultOpeningTime){
                defaultOpeningTime = new Date();
                defaultOpeningTime.setHours(openingHour,openingMinute,0,0);
                defaultClosingTime = new Date();
                defaultClosingTime.setHours(closingHour,closingMinute,0,0);
            }
        }

        const duplicateDay = parsedTimings.find((timing,index)=>parsedTimings.findIndex((current)=>current.dayOfWeek === timing.dayOfWeek) !== index);
        if(duplicateDay){
            throw new apiError(400,`${duplicateDay.dayOfWeek} timing is repeated`);
        }

        dataToUpdate.OpeningTime = defaultOpeningTime;
        dataToUpdate.ClosingTime = defaultClosingTime;
        dataToUpdate.Holidays = validShopDays
            .filter((day)=>!parsedTimings.some((timing)=>timing.dayOfWeek === day))
            .map((day)=>day.toLowerCase());
        dataToUpdate.timings = {
            deleteMany:{},
            create:parsedTimings
        };

        if(dataToUpdate.ShopOpenStatus === undefined){
            dataToUpdate.ShopOpenStatus = "AUTOMATIC";
            dataToUpdate.status = "AUTOMATIC";
        }
    }

    if(!Object.keys(dataToUpdate).length){
        throw new apiError(400,"no shop settings provided for update");
    }

    const shopData = await prisma.shop.update({
        where:{
            id:shopId
        },
        data:dataToUpdate,
        select:{
            id:true,
            shopName:true,
            shopImage:true,
            Address:true,
            Tags:true,
            Description:true,
            OpeningTime:true,
            ClosingTime:true,
            ShopOpenStatus:true,
            status:true,
            Holidays:true,
            Verified:true,
            shopType:{
                select:{
                    id:true,
                    name:true,
                    slug:true,
                    features:{
                        where:{enabled:true},
                        select:{feature:true}
                    }
                }
            },
            MinimumDeliveryRate:true,
            FreeDeliveryRate:true,
            latitude:true,
            longitude:true,
            timings:{
                orderBy:{
                    dayOfWeek:"asc"
                },
                select:{
                    id:true,
                    dayOfWeek:true,
                    startMinute:true,
                    endMinute:true,
                    active:true
                }
            }
        }
    });

    return res.status(200).json(new apiResponse(200,{
        id:shopData.id,
        shopName:shopData.shopName,
        shopImage:shopData.shopImage,
        address:shopData.Address,
        tags:shopData.Tags,
        description:shopData.Description,
        configuredStatus:shopData.ShopOpenStatus,
        holidays:shopData.Holidays,
        verified:shopData.Verified,
        shopType:shopData.shopType ? {
            id:shopData.shopType.id,
            name:shopData.shopType.name,
            slug:shopData.shopType.slug,
            features:shopData.shopType.features.map((feature)=>feature.feature)
        } : null,
        minimumDeliveryRate:shopData.MinimumDeliveryRate,
        freeDeliveryRate:shopData.FreeDeliveryRate,
        latitude:shopData.latitude,
        longitude:shopData.longitude,
        timings:shopData.timings
    },"shop settings updated successfully"));
})

const setShopStatus = asyncHandler(async(req,res)=>{
    const {shopId} = req.params;

    if(!shopId) throw new apiError(400,"shop id is required");

    const existingShop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true,
            shopName:true,
            OpeningTime:true,
            ClosingTime:true,
            ShopOpenStatus:true,
            status:true,
            Holidays:true,
            timings:{
                orderBy:{
                    dayOfWeek:"asc"
                },
                select:{
                    dayOfWeek:true,
                    startMinute:true,
                    endMinute:true,
                    active:true
                }
            }
        }
    });

    if(!existingShop) throw new apiError(404,"shop not found");

    if(req.currentUser?.role !== "ADMIN" && existingShop.ownerId !== req.userData?.id){
        throw new apiError(403,"you are not allowed to update this shop status");
    }

    const requestedStatus = req.body.status ?? req.body.shopOpenStatus ?? req.query.status;
    const currentOpenState = calculateShopOpenState(existingShop);
    const nextStatus = requestedStatus === undefined
        ? (currentOpenState.openStatus === "OPEN" ? "CLOSED" : "OPEN")
        : parseShopStatus(requestedStatus);

    const shopData = await prisma.shop.update({
        where:{
            id:shopId
        },
        data:{
            status:nextStatus,
            ShopOpenStatus:nextStatus
        },
        select:{
            id:true,
            shopName:true,
            ownerId:true,
            OpeningTime:true,
            ClosingTime:true,
            ShopOpenStatus:true,
            status:true,
            Holidays:true,
            timings:{
                orderBy:{
                    dayOfWeek:"asc"
                },
                select:{
                    dayOfWeek:true,
                    startMinute:true,
                    endMinute:true,
                    active:true
                }
            },
            updatedAt:true
        }
    });

    const openState = calculateShopOpenState(shopData);

    return res.status(200).json(new apiResponse(200,{
        id:shopData.id,
        shopName:shopData.shopName,
        configuredStatus:openState.configuredStatus,
        openStatus:openState.openStatus,
        isOpenNow:openState.isOpenNow,
        todayTiming:openState.todayTiming
    },"shop status updated successfully"));
})


const findNearbyShops = asyncHandler(async(req,res)=>{
    const buyerId = req.userData?.id;
    if(!buyerId) throw new apiError(401,"Unauthorized user");

    const radiusKm = req.query.radius === undefined ? 10 : Number(req.query.radius);
    if(!Number.isFinite(radiusKm) || radiusKm <= 0){
        throw new apiError(400,"radius must be a valid positive number");
    }
    const pagination = getPagination(req.query,{defaultLimit:20,maxLimit:50});

    const buyer = await prisma.user.findUnique({
        where:{
            id:buyerId
        },
        select:{
            id:true,
            latitude:true,
            longitude:true
        }
    });

    if(!buyer) throw new apiError(404,"buyer not found");
    if(buyer.latitude === null || buyer.longitude === null){
        throw new apiError(400,"buyer location is not available");
    }

    const requestedStatus = req.query.status ? String(req.query.status).trim().toUpperCase() : "ALL";
    if(!["ALL","OPEN","CLOSED"].includes(requestedStatus)){
        throw new apiError(400,"status must be ALL, OPEN, or CLOSED");
    }

    const earthRadiusKm = 6371;
    const latitudeDelta = radiusKm / 111.32;
    const longitudeScale = Math.abs(Math.cos((buyer.latitude * Math.PI) / 180));
    const longitudeDelta = longitudeScale < 0.000001 ? 180 : radiusKm / (111.32 * longitudeScale);
    const debugNearby = isTruthyQuery(req.query.debug);
    const cacheKey = `buyer:shops:nearby:v2:${buyerId}:${radiusKm}:${requestedStatus}:${pagination.page}:${pagination.limit}:${debugNearby}`;

    if(!debugNearby){
        const cachedNearbyShops = await getCachedData(cacheKey);
        if(cachedNearbyShops){
            return res.status(200).json(new apiResponse(200,cachedNearbyShops,"nearby shops fetched successfully"));
        }
    }

    const shops = await prisma.shop.findMany({
        where:{
            Verified:true,
            latitude:{
                not:null,
                gte:buyer.latitude - latitudeDelta,
                lte:buyer.latitude + latitudeDelta
            },
            longitude:{
                not:null,
                gte:buyer.longitude - longitudeDelta,
                lte:buyer.longitude + longitudeDelta
            }
        },
        select:{
            id:true,
            shopName:true,
            shopImage:true,
            Address:true,
            Tags:true,
            Description:true,
            OpeningTime:true,
            ClosingTime:true,
            ShopOpenStatus:true,
            status:true,
            Holidays:true,
            Verified:true,
            shopType:{
                select:{
                    id:true,
                    name:true,
                    slug:true,
                    features:{
                        where:{enabled:true},
                        select:{feature:true}
                    }
                }
            },
            MinimumDeliveryRate:true,
            FreeDeliveryRate:true,
            latitude:true,
            longitude:true,
            slug:true,
            timings:{
                orderBy:{
                    dayOfWeek:"asc"
                },
                select:{
                    dayOfWeek:true,
                    startMinute:true,
                    endMinute:true,
                    active:true
                }
            }
        }
    });

    const debugCounts = debugNearby
        ? await Promise.all([
            prisma.shop.count(),
            prisma.shop.count({
                where:{
                    Verified:true
                }
            }),
            prisma.shop.count({
                where:{
                    Verified:true,
                    latitude:{
                        not:null
                    },
                    longitude:{
                        not:null
                    }
                }
            })
        ])
        : null;

    const now = new Date();

    const shopsWithinRadius = shops
        .map((shop)=>{
            const buyerLatitudeRadian = (buyer.latitude * Math.PI) / 180;
            const shopLatitudeRadian = (shop.latitude * Math.PI) / 180;
            const latitudeDifference = ((shop.latitude - buyer.latitude) * Math.PI) / 180;
            const longitudeDifference = ((shop.longitude - buyer.longitude) * Math.PI) / 180;
            const haversinePart = Math.sin(latitudeDifference / 2) * Math.sin(latitudeDifference / 2)
                + Math.cos(buyerLatitudeRadian) * Math.cos(shopLatitudeRadian)
                * Math.sin(longitudeDifference / 2) * Math.sin(longitudeDifference / 2);
            const distanceKm = earthRadiusKm * (2 * Math.atan2(Math.sqrt(haversinePart),Math.sqrt(1 - haversinePart)));

            const openState = calculateShopOpenState(shop, now);

            return {
                ...shop,
                distanceKm:Number(distanceKm.toFixed(2)),
                configuredStatus:openState.configuredStatus,
                openStatus:openState.openStatus,
                isOpenNow:openState.isOpenNow,
                todayTiming:openState.todayTiming
            };
        })
        .filter((shop)=>shop.distanceKm <= radiusKm)
        .sort((a,b)=>a.distanceKm - b.distanceKm);

    const nearbyShops = shopsWithinRadius
        .filter((shop)=>requestedStatus === "ALL" || shop.openStatus === requestedStatus);

    const responseData = {
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total:nearbyShops.length
        }),
        radiusKm,
        shops:nearbyShops.slice(pagination.skip,pagination.skip + pagination.limit).map((shop)=>({
            id:shop.id,
            shopName:shop.shopName,
            shopImage:shop.shopImage,
            address:shop.Address,
            description:shop.Description,
            tags:shop.Tags,
            slug:shop.slug,
            shopType:shop.shopType ? {
                id:shop.shopType.id,
                name:shop.shopType.name,
                slug:shop.shopType.slug,
                features:shop.shopType.features?.map((feature)=>feature.feature) || []
            } : null,
            minimumDeliveryRate:shop.MinimumDeliveryRate,
            freeDeliveryRate:shop.FreeDeliveryRate,
            distanceKm:shop.distanceKm,
            configuredStatus:shop.configuredStatus,
            openStatus:shop.openStatus,
            isOpenNow:shop.isOpenNow,
            todayTiming:shop.todayTiming
        })),
        ...(debugNearby ? {
            debug:{
                requestedStatus,
                latitudeRange:{
                    min:buyer.latitude - latitudeDelta,
                    max:buyer.latitude + latitudeDelta
                },
                longitudeRange:{
                    min:buyer.longitude - longitudeDelta,
                    max:buyer.longitude + longitudeDelta
                },
                totalShopsInDatabase:debugCounts[0],
                verifiedShopsInDatabase:debugCounts[1],
                verifiedShopsWithLocation:debugCounts[2],
                verifiedShopsInsideBoundingBox:shops.length,
                verifiedShopsInsideRadiusBeforeStatusFilter:shopsWithinRadius.length,
                statusFilteredOut:shopsWithinRadius.length - nearbyShops.length
            }
        } : {})
    };

    if(!debugNearby){
        await setCachedData(cacheKey,responseData,30);
    }

    return res.status(200).json(new apiResponse(200,responseData,"nearby shops fetched successfully"));
})


const findByShopSlug = asyncHandler(async(req,res)=>{
    const { slug} = req.params
    if(!slug) throw new apiError(400," slug not recieved from user")

    const cacheKey = `buyer:shop:slug:${slug}`;
    const cachedShop = await getCachedData(cacheKey);
    if(cachedShop){
        return res.status(200).json(new apiResponse(200,cachedShop,"slug based shop found"));
    }
    
    const shopData = await prisma.shop.findUnique({
        where: {
            slug: slug
        },
        select: {
            id: true,
            shopName:true,
            shopImage:true,
            Address:true,
            Tags:true,
            Description:true,
            OpeningTime:true,
            ClosingTime:true,
            ShopOpenStatus:true,
            status:true,
            Holidays:true,
            timings:{
                orderBy:{
                    dayOfWeek:"asc"
                },
                select:{
                    id:true,
                    dayOfWeek:true,
                    startMinute:true,
                    endMinute:true,
                    active:true
                }
            },
            Verified:true,
            billingStatus:true,
            trialStartedAt:true,
            trialDays:true,
            trialEndsAt:true,
            shopType:{
                select:{
                    id:true,
                    name:true,
                    slug:true,
                    features:{
                        where:{enabled:true},
                        select:{feature:true}
                    }
                }
            },
            MinimumDeliveryRate:true,
            FreeDeliveryRate:true,
            latitude:true,
            longitude:true,
            owner: {
                select: {
                    id: true,
                    name:true,
                    profileImg:true
                }
            },
            items:{
                where:{
                    active:true
                },
                orderBy:{
                    sortOrderId:"asc"
                },
                select:{
                    id:true,
                    pricing:true,
                    availableQuantity:true,
                    imageUrl:true,
                    description:true,
                    sortOrderId:true,
                    active:true,
                    item:{
                        select:{
                            id:true,
                            name:true,
                            imageUrl:true,
                            sortOrderId:true,
                            active:true,
                            categoryId:true,
                            category:{
                                select:{
                                    id:true,
                                    name:true,
                                    slug:true,
                                    cuisineId:true
                                }
                            }
                        }
                    }
                }
            },
            combos:{
                where:{
                    active:true
                },
                orderBy:{
                    sortOrderId:"asc"
                },
                select:{
                    id:true,
                    name:true,
                    description:true,
                    imageUrl:true,
                    totalPrice:true,
                    availableQuantity:true,
                    sortOrderId:true,
                    active:true,
                    cuisine:{
                        select:{
                            id:true,
                            name:true,
                            slug:true
                        }
                    },
                    category:{
                        select:{
                            id:true,
                            name:true,
                            slug:true
                        }
                    },
                    items:{
                        select:{
                            id:true,
                            quantity:true,
                            item:{
                                select:{
                                    id:true,
                                    pricing:true,
                                    imageUrl:true,
                                    description:true,
                                    item:{
                                        select:{
                                            id:true,
                                            name:true,
                                            imageUrl:true,
                                            categoryId:true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if(!shopData) throw new apiError(400,"The slug cant be found")

    const responseData = formatShopBrowseData(shopData);
    await setCachedData(cacheKey,responseData,60);

    return res.status(200).json(new apiResponse(200,responseData,"slug based shop found"))
})

// ************************************************************************************************


// const createRecharge = asyncHandler(async(req,res)=>{
//     const amount = parseRechargeAmount(req.body.amount)
//     const userId = req.userData?.id;

//     if (!userId) {
//         throw new apiError(403, "You need to login first");
//     }

//     const user = await prisma.user.findUnique({
//         where: {
//             id: userId,
//         },
//         select: {
//             id: true,
//             isVerified: true,
//             isBlocked: true,
//         },
//     });

//     if (!user || !user.isVerified || user.isBlocked) {
//         throw new apiError(400, "user potentially blocked from recharging");
//     }

//     const shopInfo = await prisma.shop.findFirst({
//         where:{
//             ownerId:userId,
//         }
//         ,select:{
//             id:true,
//             shopName:true,
//             Verified:true,
//             billingStatus:true,
//             trialStartedAt:true,
//             trialDays:true,
//             trialEndsAt:true,
//         }
//     })

//     if (!shopInfo) {
//         throw new apiError(404, "Shop not found for this user");
//     }

//     const createInstance = await prisma.recharges.create({
//         data:{
//             userId,
//             shopId:shopInfo.id,
//             orderAmount:amount,
//             status:"PENDING"
//         }
//     })
//     if(!createInstance) throw new apiError(400," recharging failure occured! ")

//     return res
//         .status(201)
//         .json(new apiResponse(201, createInstance, "Recharge Request Created"))
// })

// const approveRecharge = asyncHandler(async (req, res) => {
//     const { rechargeId } = req.params;

//     if (!rechargeId) {
//         throw new apiError(400, "Recharge id is required");
//     }

//     const result = await prisma.$transaction(async (tx) => {
//         const recharge = await tx.recharges.findUnique({
//             where: {
//                 id: rechargeId,
//             },
//         });

//         if (!recharge) {
//             throw new apiError(404, "Recharge request not found");
//         }

//         if (recharge.status !== "PENDING") {
//             throw new apiError(409, "Recharge request is already processed");
//         }

//         const updatedRecharge = await tx.recharges.update({
//             where: {
//                 id: rechargeId,
//             },
//             data: {
//                 status: "APPROVED",
//             },
//         });
//     if(!updatedRecharge) throw new apiError(400,"recharge status updation failed")

//         const updatedShop = await tx.shop.update({
//             where: {
//                 id: recharge.shopId,
//             },
//             data: {
//                 shopBalance: {
//                     increment: recharge.orderAmount,
//                 },
//             },
//         });
//         if(!updatedShop) throw new apiError(400,"shop balance updation error")
//             const userInfo = await tx.user.findUnique({
//         where:{
//             id:recharge.userId
//         },
//         select:{
//             billingPlan:true,
//             isVerified:true
//         }
//     })
//     if(!userInfo) throw new apiError(400,"transaction target user fetching failed")

//         if(userInfo.billingPlan=="TRIAL"){
//             const userInfo = await tx.user.update({
//             where:{
//                 id:recharge.userId
//             },
//             data:{
//                 billingPlan:"ACTIVE"
//             }
//         })
//         }
//         return {
//             recharge: updatedRecharge,
//             shop: updatedShop,
//         };
//     });

//     return res
//         .status(200)
//         .json(new apiResponse(200, result, "Recharge approved and shop balance updated"));
// });

// const getPendingRecharges = asyncHandler(async (req, res) => {
//     if(!req.userData.id) throw new apiError(400,"user not logged in")
//     const pendingRecharges = await prisma.recharges.findMany({
//         where: {
//             status: "PENDING",
//         },
//         include: {
//     user: {
//         select: {
//             id: true,
//             name: true,
//             email: true,
//             phone: true,
//         },
//     },
//     shop: {
//         select: {
//             id: true,
//             shopName: true,
//             shopBalance: true,
//             Verified: true,
//             billingStatus: true,
//             trialStartedAt: true,
//             trialDays: true,
//             trialEndsAt: true,
//         },
//     },
// },
//         orderBy: {
//             createdAt: "desc",
//         },
//     });
//     if(!pendingRecharges) throw new apiError(400,"pending based recharges fetching  failure!!")
//     return res
//         .status(200)
//         .json(new apiResponse(200, pendingRecharges, "Pending recharge requests fetched successfully"));
// });

// const getAllRecharges = asyncHandler(async (req, res) => {
//         if(!req.userData.id) throw new apiError(400,"user not logged in")
//     const recharges = await prisma.recharges.findMany({
//         include: {
//     user: {
//         select: {
//             id: true,
//             name: true,
//             email: true,
//             phone: true,
//         },
//     },
//     shop: {
//         select: {
//             id: true,
//             shopName: true,
//             shopBalance: true,
//             Verified: true,
//             billingStatus: true,
//             trialStartedAt: true,
//             trialDays: true,
//             trialEndsAt: true,
//         },
//     },
// },
//         orderBy: {
//             createdAt: "desc",
//         },
//     });
//     if(!recharges) throw new apiError(400,"all recharges fetching failure!!")
//     return res
//         .status(200)
//         .json(new apiResponse(200, recharges, "Recharge requests fetched successfully"));
// });

export {
    createShop,
    makeSellerGoLive,
    deleteSeller,
    findFullShopData,
    setShopTrialPeriod,
    setShopTimings,
    setShopStatus,
    editShopSettings,
    findNearbyShops,
    findByShopSlug,



    // createRecharge,
    // approveRecharge,
    // getPendingRecharges,
    // getAllRecharges,
};
