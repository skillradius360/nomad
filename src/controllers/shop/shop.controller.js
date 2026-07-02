import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { cloudUploader } from "../../utils/cloudinary.upload.js";
import { deleteCacheByPattern, getCachedData, setCachedData } from "../../utils/cache.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";
import { formatShopFeatureMap, getEffectiveShopFeatures, normalizeShopFeature, normalizeShopFeatures } from "../../utils/shopFeatures.js";
import {
    calculateShopItemLowestPrice,
    formatShopItemVariantGroups,
    formatShopItemPricing,
    hasShopItemVariants,
    shopItemVariantSelect
} from "../../utils/shopItemVariants.js";

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

const parseOptionalBoolean = (value, fieldName) => {
    if(value === undefined) return undefined;
    if(typeof value === "boolean") return value;
    if(value === null || value === "") return null;

    const normalizedValue = String(value).trim().toLowerCase();
    if(["true","1","yes","on"].includes(normalizedValue)) return true;
    if(["false","0","no","off"].includes(normalizedValue)) return false;

    throw new apiError(400,`${fieldName} must be true or false`);
};

const parseJsonMaybe = (value, fieldName)=>{
    if(typeof value !== "string") return value;
    const trimmedValue = value.trim();
    if(!trimmedValue) return value;
    if(!trimmedValue.startsWith("[") && !trimmedValue.startsWith("{")) return value;

    try{
        return JSON.parse(trimmedValue);
    }catch{
        throw new apiError(400,`${fieldName} must be valid JSON`);
    }
};

const parseFeatureListInput = (value)=>{
    const parsedValue = parseJsonMaybe(value,"features");
    if(Array.isArray(parsedValue)) return parsedValue;
    if(parsedValue === undefined || parsedValue === null || parsedValue === "") return [];
    return String(parsedValue)
        .split(",")
        .map((feature)=>feature.trim())
        .filter(Boolean);
};

const buildShopFeatureOverrideInputs = ({feature,features,featureEnabled,enabled,featureOverrides,overrides})=>{
    const rawOverrides = featureOverrides ?? overrides;
    if(rawOverrides !== undefined){
        const parsedOverrides = parseJsonMaybe(rawOverrides,"featureOverrides");
        if(!Array.isArray(parsedOverrides)){
            throw new apiError(400,"featureOverrides must be an array");
        }

        return parsedOverrides.map((override)=>({
            feature:normalizeShopFeature(override.feature),
            enabled:Boolean(parseOptionalBoolean(override.enabled,"featureOverrides.enabled") ?? true)
        }));
    }

    const selectedFeatures = parseFeatureListInput(features);
    if(feature !== undefined){
        selectedFeatures.push(...parseFeatureListInput(feature));
    }

    if(selectedFeatures.length === 0) return [];

    const normalizedFeatures = normalizeShopFeatures(selectedFeatures);
    const overrideEnabled = parseOptionalBoolean(featureEnabled ?? enabled,"featureEnabled") ?? true;
    return normalizedFeatures.map((normalizedFeature)=>({
        feature:normalizedFeature,
        enabled:overrideEnabled
    }));
};

const invalidateShopCaches = async(shop)=>{
    await Promise.all([
        deleteCacheByPattern(`catalog:shop:${shop.id}:*`),
        deleteCacheByPattern(`buyer:shop:full:${shop.id}`),
        deleteCacheByPattern(`buyer:shop:full:*:${shop.id}`),
        deleteCacheByPattern(`buyer:shop:${shop.id}:*`),
        deleteCacheByPattern("buyer:shops:nearby:*"),
        shop.slug ? deleteCacheByPattern(`buyer:shop:slug:${shop.slug}`) : Promise.resolve(),
        shop.slug ? deleteCacheByPattern(`buyer:shop:slug:*:${shop.slug}`) : Promise.resolve()
    ]);
};

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
    ...formatShopItemPricing(shopItem),
    lowestPrice:calculateShopItemLowestPrice(shopItem),
    finalPrice:calculateShopItemLowestPrice(shopItem),
    hasVariants:hasShopItemVariants(shopItem),
    variantGroups:formatShopItemVariantGroups(shopItem.variantGroups),
    availableQuantity:shopItem.availableQuantity,
    imageUrl:shopItem.imageUrl || shopItem.item?.imageUrl || null,
    brandId:shopItem.brandId || null,
    brand:shopItem.brand ? {
        id:shopItem.brand.id,
        name:shopItem.brand.name,
        slug:shopItem.brand.slug,
        imageUrl:shopItem.brand.imageUrl
    } : null,
    description:shopItem.description,
    prescriptionRequired:shopItem.prescriptionRequired || false,
    prescriptionNote:shopItem.prescriptionNote || null,
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
        ...formatShopItemPricing(comboItem.item),
        lowestPrice:calculateShopItemLowestPrice(comboItem.item),
        finalPrice:calculateShopItemLowestPrice(comboItem.item),
        hasVariants:hasShopItemVariants(comboItem.item),
        variantGroups:formatShopItemVariantGroups(comboItem.item?.variantGroups),
        imageUrl:comboItem.item?.imageUrl || comboItem.item?.item?.imageUrl || null,
        description:comboItem.item?.description,
        prescriptionRequired:comboItem.item?.prescriptionRequired || false,
        prescriptionNote:comboItem.item?.prescriptionNote || null,
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

const addCategoryToMap = (categories,category)=>{
    if(!category?.id || categories.has(category.id)) return;
    categories.set(category.id,{
        id:category.id,
        name:category.name,
        slug:category.slug || null,
        cuisineId:category.cuisineId || null,
        cuisineName:category.cuisine?.name || null,
        cuisineSlug:category.cuisine?.slug || null
    });
};

const formatBuyerCatalogMenu = (menu)=>({
    id:menu.id,
    name:menu.name,
    description:menu.description,
    sortOrderId:menu.sortOrderId,
    schedules:menu.schedules?.map((schedule)=>({
        dayOfWeek:schedule.dayOfWeek,
        startMinute:schedule.startMinute,
        endMinute:schedule.endMinute
    })) || [],
    items:menu.items?.map((menuItem)=>({
        shopItemId:menuItem.itemId,
        menuItemId:menuItem.id,
        menuSortOrderId:menuItem.sortOrderId
    })) || [],
    combos:menu.combos?.map((menuCombo)=>({
        comboId:menuCombo.comboId,
        menuComboId:menuCombo.id,
        menuSortOrderId:menuCombo.sortOrderId
    })) || []
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
            enabled:shop.deliveryEnabled,
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
        items:shop.items?.map((item)=>({
            ...item,
            ...formatShopItemPricing(item),
            lowestPrice:calculateShopItemLowestPrice(item),
            finalPrice:calculateShopItemLowestPrice(item),
            hasVariants:hasShopItemVariants(item),
            variantGroups:formatShopItemVariantGroups(item.variantGroups)
        })) || [],
        combos:shop.combos?.map((combo)=>({
            ...combo,
            items:combo.items?.map((item)=>({
                ...item,
                ...formatShopItemPricing(item),
                lowestPrice:calculateShopItemLowestPrice(item),
                finalPrice:calculateShopItemLowestPrice(item),
                hasVariants:hasShopItemVariants(item),
                variantGroups:formatShopItemVariantGroups(item.variantGroups)
            })) || []
        })) || []
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
        address, latitude, longitude,shopTypeId,shopTypeSlug}= req.body
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

        const ownerLocation = await prisma.user.findUnique({
            where:{
                id:ownerId
            },
            select:{
                address:true,
                latitude:true,
                longitude:true
            }
        });

        const shopLatitude = latitude !== undefined ? parseOptionalCoordinate(latitude, "latitude") : ownerLocation?.latitude ?? null;
        const shopLongitude = longitude !== undefined ? parseOptionalCoordinate(longitude, "longitude") : ownerLocation?.longitude ?? null;

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
        Address:address !== undefined ? String(address).trim() : ownerLocation?.address ?? null,
        Description:description,
        slug:createSlug,
        OpeningTime:null,
        ClosingTime:null,
        ShopOpenStatus:"CLOSED",
        status:"CLOSED",
        Holidays:validShopDays.map((day)=>day.toLowerCase()),
        Verified:req.currentUser?.role === "ADMIN",
        latitude:shopLatitude,
        longitude:shopLongitude,
        shopTypeId:selectedShopType?.id
    },
    select:{
        id:true,
        shopName:true,
        shopImage:true,
        Address:true,
        Description:true,
        slug:true,
        ShopOpenStatus:true,
        status:true,
        Verified:true,
        deliveryEnabled:true,
        latitude:true,
        longitude:true,
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

    await invalidateShopCaches(shopData);

    return res.json(new apiResponse(200,{
        id:shopData.id,
        shopName:shopData.shopName,
        shopImage:shopData.shopImage,
        slug:shopData.slug,
        location:{
            address:shopData.Address,
            latitude:shopData.latitude,
            longitude:shopData.longitude
        },
        verified:shopData.Verified,
        status:shopData.status,
        deliveryEnabled:shopData.deliveryEnabled,
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

    const cacheKey = `buyer:shop:full:v4:${shopId}`;
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
            s."deliveryEnabled",
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
                    'variantGroups',COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'id',variant_group.id,
                            'name',variant_group.name,
                            'required',variant_group.required,
                            'minSelect',variant_group."minSelect",
                            'maxSelect',variant_group."maxSelect",
                            'sortOrder',variant_group."sortOrder",
                            'active',variant_group.active,
                            'options',COALESCE((
                                SELECT jsonb_agg(jsonb_build_object(
                                    'id',variant_option.id,
                                    'label',variant_option.label,
                                    'subLabel',variant_option."subLabel",
                                    'amount',variant_option.amount,
                                    'sortOrder',variant_option."sortOrder",
                                    'active',variant_option.active
                                ) ORDER BY variant_option."sortOrder")
                                FROM "ShopItemVariantOption" variant_option
                                WHERE variant_option."groupId" = variant_group.id
                            ),'[]'::jsonb)
                        ) ORDER BY variant_group."sortOrder")
                        FROM "ShopItemVariantGroup" variant_group
                        WHERE variant_group."shopItemId" = si.id
                    ),'[]'::jsonb),
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
                            'variantGroups',COALESCE((
                                SELECT jsonb_agg(jsonb_build_object(
                                    'id',variant_group.id,
                                    'name',variant_group.name,
                                    'required',variant_group.required,
                                    'minSelect',variant_group."minSelect",
                                    'maxSelect',variant_group."maxSelect",
                                    'sortOrder',variant_group."sortOrder",
                                    'active',variant_group.active,
                                    'options',COALESCE((
                                        SELECT jsonb_agg(jsonb_build_object(
                                            'id',variant_option.id,
                                            'label',variant_option.label,
                                            'subLabel',variant_option."subLabel",
                                            'amount',variant_option.amount,
                                            'sortOrder',variant_option."sortOrder",
                                            'active',variant_option.active
                                        ) ORDER BY variant_option."sortOrder")
                                        FROM "ShopItemVariantOption" variant_option
                                        WHERE variant_option."groupId" = variant_group.id
                                    ),'[]'::jsonb)
                                ) ORDER BY variant_group."sortOrder")
                                FROM "ShopItemVariantGroup" variant_group
                                WHERE variant_group."shopItemId" = combo_shop_item.id
                            ),'[]'::jsonb),
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

const fetchShopCustomers = asyncHandler(async(req,res)=>{
    const {shopId} = req.params;
    const pagination = getPagination(req.query,{defaultLimit:20,maxLimit:100});

    if(!shopId) throw new apiError(400,"shop id is required");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(req.currentUser?.role !== "ADMIN" && shop.ownerId !== req.userData?.id){
        throw new apiError(403,"You can only fetch customers for your own shop");
    }

    const [totalRows,customers] = await Promise.all([
        prisma.$queryRaw`
            SELECT COUNT(DISTINCT orders."userId")::int AS total
            FROM "Order" orders
            WHERE orders."shopId" = ${shopId}
        `,
        prisma.$queryRaw`
            SELECT
                users.id,
                users.name,
                users.email,
                users.phone,
                users."profileImg",
                users.address,
                users.latitude,
                users.longitude,
                COUNT(orders.id)::int AS "totalOrders",
                COUNT(orders.id) FILTER (WHERE orders."currentOrderStatus" = 'COMPLETED')::int AS "completedOrders",
                COUNT(orders.id) FILTER (WHERE orders."currentOrderStatus" = 'CANCELLED')::int AS "cancelledOrders",
                COALESCE(SUM(orders."totalAmount"),0)::int AS "totalSpent",
                MAX(orders."createdAt") AS "lastOrderAt"
            FROM "Order" orders
            INNER JOIN "User" users ON users.id = orders."userId"
            WHERE orders."shopId" = ${shopId}
            GROUP BY users.id
            ORDER BY MAX(orders."createdAt") DESC
            LIMIT ${pagination.take}
            OFFSET ${pagination.skip}
        `
    ]);

    const total = totalRows?.[0]?.total || 0;

    return res.status(200).json(new apiResponse(200,{
        shop:{
            id:shop.id,
            shopName:shop.shopName
        },
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        customers
    },"shop customers fetched successfully"));
});

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
        deliveryEnabled,
        latitude,
        longitude,
        feature,
        features,
        featureEnabled,
        enabled,
        featureOverrides,
        overrides
    } = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");

    const existingShop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true,
            shopImage:true,
            slug:true
        }
    });

    if(!existingShop) throw new apiError(404,"shop not found");

    if(req.currentUser?.role !== "ADMIN" && existingShop.ownerId !== req.userData?.id){
        throw new apiError(403,"you are not allowed to edit this shop");
    }

    const dataToUpdate = {};
    const featureOverrideInputs = buildShopFeatureOverrideInputs({
        feature,
        features,
        featureEnabled,
        enabled,
        featureOverrides,
        overrides
    });

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

    if(deliveryEnabled !== undefined){
        dataToUpdate.deliveryEnabled = parseOptionalBoolean(deliveryEnabled,"deliveryEnabled") ?? true;
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

    if(!Object.keys(dataToUpdate).length && featureOverrideInputs.length === 0){
        throw new apiError(400,"no shop settings provided for update");
    }

    if(Object.keys(dataToUpdate).length){
        await prisma.shop.update({
            where:{
                id:shopId
            },
            data:dataToUpdate
        });
    }

    if(featureOverrideInputs.length > 0){
        const uniqueOverrides = [...new Map(featureOverrideInputs.map((override)=>[override.feature,override])).values()];
        await prisma.$transaction(
            uniqueOverrides.map((override)=>prisma.shopFeatureOverride.upsert({
                where:{
                    shopId_feature:{
                        shopId,
                        feature:override.feature
                    }
                },
                update:{
                    enabled:override.enabled
                },
                create:{
                    shopId,
                    feature:override.feature,
                    enabled:override.enabled
                }
            }))
        );
    }

    const shopData = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            slug:true,
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
            featureOverrides:{
                select:{
                    feature:true,
                    enabled:true
                }
            },
            MinimumDeliveryRate:true,
            FreeDeliveryRate:true,
            deliveryEnabled:true,
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

    await invalidateShopCaches(shopData);

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
        features:{
            baseFeatures:shopData.shopType?.features.map((feature)=>feature.feature) || [],
            overrides:shopData.featureOverrides,
            effectiveFeatures:getEffectiveShopFeatures(shopData)
        },
        minimumDeliveryRate:shopData.MinimumDeliveryRate,
        freeDeliveryRate:shopData.FreeDeliveryRate,
        deliveryEnabled:shopData.deliveryEnabled,
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

const toggleShopAvailability = asyncHandler(async(req,res)=>{
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
            deliveryEnabled:true,
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
        throw new apiError(403,"you are not allowed to update this shop availability");
    }

    const shopOpenInput = req.body.shopOpen ?? req.body.isOpen ?? req.body.open;
    const explicitStatusInput = req.body.status ?? req.body.shopOpenStatus;
    const deliveryInput = req.body.deliveryEnabled ?? req.body.deliveryOn ?? req.body.isDeliveryEnabled;
    const shouldToggleShop = parseOptionalBoolean(req.body.toggleShop, "toggleShop") === true;
    const shouldToggleDelivery = parseOptionalBoolean(req.body.toggleDelivery, "toggleDelivery") === true;
    const currentOpenState = calculateShopOpenState(existingShop);
    const dataToUpdate = {};

    if(explicitStatusInput !== undefined){
        const nextStatus = parseShopStatus(explicitStatusInput);
        dataToUpdate.status = nextStatus;
        dataToUpdate.ShopOpenStatus = nextStatus;
    }else if(shopOpenInput !== undefined){
        const shopOpen = parseOptionalBoolean(shopOpenInput,"shopOpen");
        if(shopOpen === null) throw new apiError(400,"shopOpen must be true or false");
        const nextStatus = shopOpen ? "OPEN" : "CLOSED";
        dataToUpdate.status = nextStatus;
        dataToUpdate.ShopOpenStatus = nextStatus;
    }else if(shouldToggleShop || (deliveryInput === undefined && !shouldToggleDelivery)){
        const nextStatus = currentOpenState.openStatus === "OPEN" ? "CLOSED" : "OPEN";
        dataToUpdate.status = nextStatus;
        dataToUpdate.ShopOpenStatus = nextStatus;
    }

    if(deliveryInput !== undefined){
        const nextDeliveryEnabled = parseOptionalBoolean(deliveryInput,"deliveryEnabled");
        if(nextDeliveryEnabled === null) throw new apiError(400,"deliveryEnabled must be true or false");
        dataToUpdate.deliveryEnabled = nextDeliveryEnabled;
    }else if(shouldToggleDelivery){
        dataToUpdate.deliveryEnabled = !existingShop.deliveryEnabled;
    }

    if(!Object.keys(dataToUpdate).length){
        throw new apiError(400,"no shop availability fields provided");
    }

    const shopData = await prisma.shop.update({
        where:{
            id:shopId
        },
        data:dataToUpdate,
        select:{
            id:true,
            shopName:true,
            ownerId:true,
            OpeningTime:true,
            ClosingTime:true,
            ShopOpenStatus:true,
            status:true,
            deliveryEnabled:true,
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
        deliveryEnabled:shopData.deliveryEnabled,
        todayTiming:openState.todayTiming
    },"shop availability updated successfully"));
});

const fetchAllShops = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query,{defaultLimit:20,maxLimit:100});

    const [shops,total] = await Promise.all([
        prisma.shop.findMany({
            orderBy:{
                createdAt:"desc"
            },
            skip:pagination.skip,
            take:pagination.take,
            select:{
                id:true,
                shopName:true,
                shopImage:true,
                Address:true,
                Tags:true,
                latitude:true,
                longitude:true,
                slug:true,
                deliveryEnabled:true,
                Verified:true
            }
        }),
        prisma.shop.count()
    ]);

    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({
            page:pagination.page,
            limit:pagination.limit,
            total
        }),
        shops:shops.map((shop)=>({
            id:shop.id,
            name:shop.shopName,
            img:shop.shopImage,
            tags:shop.Tags,
            slug:shop.slug,
            verified:shop.Verified,
            deliveryEnabled:shop.deliveryEnabled,
            location:{
                address:shop.Address,
                latitude:shop.latitude,
                longitude:shop.longitude
            }
        }))
    },"shops fetched successfully"));
});

const findNearbyShops = asyncHandler(async(req,res)=>{
    const buyerId = req.userData?.id;
    if(!buyerId) throw new apiError(401,"Unauthorized user");

    const radiusKm = req.query.radius === undefined ? 10 : Number(req.query.radius);
    if(!Number.isFinite(radiusKm) || radiusKm <= 0){
        throw new apiError(400,"radius must be a valid positive number");
    }
    const shouldPaginateNearby = req.query.page !== undefined || req.query.limit !== undefined || req.query.take !== undefined;
    const pagination = shouldPaginateNearby ? getPagination(req.query,{defaultLimit:20,maxLimit:50}) : null;

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
    const buyerLatitudeKey = Number(buyer.latitude).toFixed(6);
    const buyerLongitudeKey = Number(buyer.longitude).toFixed(6);
    const cacheScope = pagination ? `${pagination.page}:${pagination.limit}` : "all";
    const cacheKey = `buyer:shops:nearby:v5:${buyerId}:${buyerLatitudeKey}:${buyerLongitudeKey}:${radiusKm}:${requestedStatus}:${cacheScope}:${debugNearby}`;

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
            deliveryEnabled:true,
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

    const responseShops = pagination
        ? nearbyShops.slice(pagination.skip,pagination.skip + pagination.limit)
        : nearbyShops;

    const responseData = {
        pagination:pagination
            ? buildPaginationMeta({
                page:pagination.page,
                limit:pagination.limit,
                total:nearbyShops.length
            })
            : {
                page:1,
                limit:nearbyShops.length,
                total:nearbyShops.length,
                totalPages:nearbyShops.length > 0 ? 1 : 0
            },
        radiusKm,
        shops:responseShops.map((shop)=>({
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
            deliveryEnabled:shop.deliveryEnabled,
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

    const cacheKey = `buyer:shop:slug:v2:${slug}`;
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
            deliveryEnabled:true,
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
                    variantGroups:{
                        orderBy:{sortOrder:"asc"},
                        select:shopItemVariantSelect
                    },
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
                                    variantGroups:{
                                        orderBy:{sortOrder:"asc"},
                                        select:shopItemVariantSelect
                                    },
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

const fetchBuyerShopItems = asyncHandler(async(req,res)=>{
    const { shopId } = req.params;

    if(!shopId) throw new apiError(400,"shopId is required");

    const cacheKey = `buyer:shop:${shopId}:fetchshopitems:v1`;
    const cachedCatalog = await getCachedData(cacheKey);
    if(cachedCatalog){
        return res.status(200).json(new apiResponse(200,cachedCatalog,"buyer shop items fetched successfully"));
    }

    const now = new Date();
    const shopData = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            shopImage:true,
            Address:true,
            Tags:true,
            Description:true,
            slug:true,
            OpeningTime:true,
            ClosingTime:true,
            ShopOpenStatus:true,
            status:true,
            Holidays:true,
            Verified:true,
            billingStatus:true,
            MinimumDeliveryRate:true,
            FreeDeliveryRate:true,
            deliveryEnabled:true,
            latitude:true,
            longitude:true,
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
            featureOverrides:{
                select:{
                    feature:true,
                    enabled:true
                }
            },
            timings:{
                where:{active:true},
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
            items:{
                where:{active:true},
                orderBy:{sortOrderId:"asc"},
                select:{
                    id:true,
                    pricing:true,
                    availableQuantity:true,
                    imageUrl:true,
                    description:true,
                    prescriptionRequired:true,
                    prescriptionNote:true,
                    sortOrderId:true,
                    active:true,
                    brandId:true,
                    brand:{
                        select:{
                            id:true,
                            name:true,
                            slug:true,
                            imageUrl:true
                        }
                    },
                    variantGroups:{
                        orderBy:{sortOrder:"asc"},
                        select:shopItemVariantSelect
                    },
                    item:{
                        select:{
                            id:true,
                            name:true,
                            imageUrl:true,
                            categoryId:true,
                            category:{
                                select:{
                                    id:true,
                                    name:true,
                                    slug:true,
                                    cuisineId:true,
                                    cuisine:{
                                        select:{
                                            id:true,
                                            name:true,
                                            slug:true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            combos:{
                where:{active:true},
                orderBy:{sortOrderId:"asc"},
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
                            slug:true,
                            cuisineId:true,
                            cuisine:{
                                select:{
                                    id:true,
                                    name:true,
                                    slug:true
                                }
                            }
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
                                    availableQuantity:true,
                                    imageUrl:true,
                                    description:true,
                                    prescriptionRequired:true,
                                    prescriptionNote:true,
                                    brandId:true,
                                    brand:{
                                        select:{
                                            id:true,
                                            name:true,
                                            slug:true,
                                            imageUrl:true
                                        }
                                    },
                                    variantGroups:{
                                        orderBy:{sortOrder:"asc"},
                                        select:shopItemVariantSelect
                                    },
                                    item:{
                                        select:{
                                            id:true,
                                            name:true,
                                            imageUrl:true,
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
                            }
                        }
                    }
                }
            },
            menus:{
                where:{active:true},
                orderBy:[
                    {sortOrderId:"asc"},
                    {createdAt:"asc"}
                ],
                select:{
                    id:true,
                    name:true,
                    description:true,
                    sortOrderId:true,
                    schedules:{
                        where:{active:true},
                        orderBy:[
                            {dayOfWeek:"asc"},
                            {startMinute:"asc"}
                        ],
                        select:{
                            dayOfWeek:true,
                            startMinute:true,
                            endMinute:true
                        }
                    },
                    items:{
                        where:{active:true},
                        orderBy:{sortOrderId:"asc"},
                        select:{
                            id:true,
                            sortOrderId:true,
                            itemId:true
                        }
                    },
                    combos:{
                        where:{active:true},
                        orderBy:{sortOrderId:"asc"},
                        select:{
                            id:true,
                            sortOrderId:true,
                            comboId:true
                        }
                    }
                }
            },
            banners:{
                where:{active:true},
                orderBy:{createdAt:"desc"},
                select:{
                    id:true,
                    text:true,
                    imageUrl:true,
                    active:true,
                    createdAt:true
                }
            },
            offers:{
                where:{
                    active:true,
                    startsAt:{lte:now},
                    endsAt:{gte:now}
                },
                orderBy:{startsAt:"desc"},
                select:{
                    id:true,
                    title:true,
                    description:true,
                    offerType:true,
                    applyTo:true,
                    minQuantity:true,
                    minOrderAmount:true,
                    discountType:true,
                    discountValue:true,
                    maxDiscountAmount:true,
                    rewardQuantity:true,
                    imageUrl:true,
                    startsAt:true,
                    endsAt:true
                }
            }
        }
    });

    if(!shopData) throw new apiError(404,"shop not found");

    const openState = calculateShopOpenState(shopData);
    const items = shopData.items?.map(formatShopBrowseItem) || [];
    const combos = shopData.combos?.map(formatShopBrowseCombo) || [];
    const menus = shopData.menus?.map(formatBuyerCatalogMenu) || [];
    const categories = new Map();

    shopData.items?.forEach((shopItem)=>addCategoryToMap(categories,shopItem.item?.category));
    shopData.combos?.forEach((combo)=>addCategoryToMap(categories,combo.category));

    const categoryList = [...categories.values()];
    const hasVariants = items.some((item)=>item.hasVariants) ||
        combos.some((combo)=>combo.items?.some((item)=>item.hasVariants));

    const configuredFeatures = formatShopFeatureMap(shopData);
    const features = {
        ...configuredFeatures,
        items:items.length > 0,
        combos:combos.length > 0,
        menus:menus.length > 0,
        categories:categoryList.length > 0,
        cuisine:categoryList.some((category)=>category.cuisineId) || combos.some((combo)=>combo.cuisineId),
        variants:hasVariants,
        variance:hasVariants
    };

    const responseData = {
        shop:{
            id:shopData.id,
            shopName:shopData.shopName,
            shopImage:shopData.shopImage,
            address:shopData.Address,
            tags:shopData.Tags,
            description:shopData.Description,
            slug:shopData.slug,
            verified:shopData.Verified,
            billingStatus:shopData.billingStatus,
            shopType:shopData.shopType ? {
                id:shopData.shopType.id,
                name:shopData.shopType.name,
                slug:shopData.shopType.slug
            } : null,
            delivery:{
                enabled:shopData.deliveryEnabled,
                minimumRate:shopData.MinimumDeliveryRate,
                freeRate:shopData.FreeDeliveryRate
            },
            location:{
                latitude:shopData.latitude,
                longitude:shopData.longitude
            },
            configuredStatus:openState.configuredStatus,
            openStatus:openState.openStatus,
            isOpenNow:openState.isOpenNow,
            todayTiming:openState.todayTiming,
            orderingAvailable:shopData.Verified && shopData.billingStatus !== "HOLD" && openState.isOpenNow
        },
        features,
        categories:categoryList,
        items,
        combos,
        menus,
        banners:shopData.banners || [],
        offers:shopData.offers || []
    };

    await setCachedData(cacheKey,responseData,45);

    return res.status(200).json(new apiResponse(200,responseData,"buyer shop items fetched successfully"));
});

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
    fetchShopCustomers,
    fetchAllShops,
    setShopTrialPeriod,
    setShopTimings,
    setShopStatus,
    toggleShopAvailability,
    editShopSettings,
    findNearbyShops,
    findByShopSlug,
    fetchBuyerShopItems,



    // createRecharge,
    // approveRecharge,
    // getPendingRecharges,
    // getAllRecharges,
};
