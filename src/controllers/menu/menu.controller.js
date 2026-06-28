import { prisma } from "../../db/index.js";
import { asyncHandler,apiError,apiResponse } from "../../utils/handler.js";
import { getOrSetCachedData } from "../../utils/cache.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";
import { shopHasFeature } from "../../utils/shopFeatures.js";
import { releaseShopSlot, reserveShopSlot } from "../../utils/billing.js";
import {
    calculateShopItemLowestPrice,
    formatShopItemVariantGroups,
    formatShopItemPricing,
    hasShopItemVariants,
    shopItemVariantSelect
} from "../../utils/shopItemVariants.js";

const VALID_DAYS = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];
const SCHEDULE_PRESETS = {
    WEEKDAYS:["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"],
    WEEKENDS:["SATURDAY","SUNDAY"],
    MON_SUN:VALID_DAYS,
    EVERYDAY:VALID_DAYS,
    ALL_DAYS:VALID_DAYS
};

const getCurrentMenuWindow = (query)=>{
    const now = new Date();
    const currentDayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const dayOfWeek = String(query.dayOfWeek || VALID_DAYS[currentDayIndex]).toUpperCase();

    if(!VALID_DAYS.includes(dayOfWeek)){
        throw new apiError(400,"invalid dayOfWeek");
    }

    const currentMinute = query.currentMinute === undefined
        ? now.getHours() * 60 + now.getMinutes()
        : Number(query.currentMinute);

    if(!Number.isInteger(currentMinute) || currentMinute < 0 || currentMinute > 1439){
        throw new apiError(400,"currentMinute must be between 0 and 1439");
    }

    const previousDay = VALID_DAYS[(VALID_DAYS.indexOf(dayOfWeek) + 6) % 7];

    return {
        dayOfWeek,
        previousDay,
        currentMinute
    };
};

const isScheduleRunningNow = (schedule, dayOfWeek, previousDay, currentMinute)=>{
    if(schedule.startMinute < schedule.endMinute){
        return schedule.dayOfWeek === dayOfWeek &&
            schedule.startMinute <= currentMinute &&
            currentMinute < schedule.endMinute;
    }

    return (
        schedule.dayOfWeek === dayOfWeek &&
        currentMinute >= schedule.startMinute
    ) || (
        schedule.dayOfWeek === previousDay &&
        currentMinute < schedule.endMinute
    );
};

const normalizeSchedulePreset = (value)=>{
    const preset = String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g,"_");

    return SCHEDULE_PRESETS[preset];
};

const parseTimeToMinute = (value)=>{
    if(Number.isInteger(value)) return value;

    const rawTime = String(value || "").trim().toLowerCase().replace(/\s+/g,"");
    const match = rawTime.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);

    if(!match) return Number.NaN;

    let hour = Number(match[1]);
    const minute = match[2] === undefined ? 0 : Number(match[2]);
    const meridiem = match[3];

    if(!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59){
        return Number.NaN;
    }

    if(meridiem){
        if(hour < 1 || hour > 12) return Number.NaN;
        if(hour === 12) hour = 0;
        if(meridiem === "pm") hour += 12;
    } else if(hour < 0 || hour > 23){
        return Number.NaN;
    }

    return hour * 60 + minute;
};

const parseTimeRange = (timeRange)=>{
    if(typeof timeRange !== "string") return {};

    const parts = timeRange.split("-").map((part)=>part.trim()).filter(Boolean);

    if(parts.length !== 2) return {};

    return {
        startMinute:parseTimeToMinute(parts[0]),
        endMinute:parseTimeToMinute(parts[1])
    };
};

const normalizeMenuSchedules = (body)=>{
    if(Array.isArray(body.schedules)){
        if(body.schedules.length === 0){
            throw new apiError(400,"at least one menu schedule is required");
        }

        return body.schedules.map((schedule)=>({
            dayOfWeek:String(schedule.dayOfWeek || "").toUpperCase(),
            startMinute:Number(schedule.startMinute),
            endMinute:Number(schedule.endMinute),
            active:schedule.active ?? true
        }));
    }

    const fixedSchedule = body.schedule && typeof body.schedule === "object" ? body.schedule : body;
    const presetDays = normalizeSchedulePreset(
        fixedSchedule.scheduleType || fixedSchedule.schedulePreset || fixedSchedule.type || fixedSchedule.days
    );

    if(!presetDays){
        throw new apiError(400,"scheduleType must be one of weekdays, weekends, mon-sun, everyday, or all-days");
    }

    const rangeMinutes = parseTimeRange(fixedSchedule.timeRange || fixedSchedule.time);
    const startMinute = fixedSchedule.startMinute === undefined && fixedSchedule.startTime !== undefined
        ? parseTimeToMinute(fixedSchedule.startTime)
        : Number(fixedSchedule.startMinute ?? rangeMinutes.startMinute);
    const endMinute = fixedSchedule.endMinute === undefined && fixedSchedule.endTime !== undefined
        ? parseTimeToMinute(fixedSchedule.endTime)
        : Number(fixedSchedule.endMinute ?? rangeMinutes.endMinute);

    return presetDays.map((dayOfWeek)=>({
        dayOfWeek,
        startMinute,
        endMinute,
        active:fixedSchedule.active ?? true
    }));
};

const validateMenuSchedules = (schedules)=>{
    if(schedules.some((schedule)=>!VALID_DAYS.includes(schedule.dayOfWeek))){
        throw new apiError(400,"invalid schedule dayOfWeek");
    }

    if(schedules.some((schedule)=>!Number.isInteger(schedule.startMinute) || !Number.isInteger(schedule.endMinute))){
        throw new apiError(400,"schedule startMinute and endMinute must be valid times");
    }

    if(schedules.some((schedule)=>schedule.startMinute < 0 || schedule.startMinute > 1439 || schedule.endMinute < 1 || schedule.endMinute > 1440)){
        throw new apiError(400,"schedule minutes must be between 0 and 1440");
    }

    if(schedules.some((schedule)=>schedule.startMinute === schedule.endMinute)){
        throw new apiError(400,"schedule startMinute and endMinute cannot be same");
    }
};


// weekends
// mon-sun
// everyday
// all-days
const createMenu = asyncHandler(async(req,res)=>{
    const {
        shopId,
        name,
        description,
        active,
        sortOrderId,
        schedules,
        items,
        itemIds,
        combos,
        comboIds
    } = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");
    if(!name) throw new apiError(400,"menu name is required");

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true,
            shopType:{
                select:{
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
            }
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(!shopHasFeature(shop,"MENUS")){
        throw new apiError(403,"menus are not enabled for this shop type");
    }
    if(!shopHasFeature(shop,"COMBOS") && ((Array.isArray(combos) && combos.length) || (Array.isArray(comboIds) && comboIds.length))){
        throw new apiError(403,"combos are not enabled for this shop type");
    }
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage menus for your own shop");
    }

    const existingMenu = await prisma.menu.findFirst({
        where:{
            shopId,
            name:{
                equals:name,
                mode:"insensitive"
            }
        }
    });

    if(existingMenu) throw new apiError(409,"menu with this name already exists for this shop");

    const normalizedSchedules = normalizeMenuSchedules(req.body);
    validateMenuSchedules(normalizedSchedules);

    const selectedItems = Array.isArray(items) && items.length > 0 ? items : itemIds;
    const normalizedItems = Array.isArray(selectedItems)
        ? selectedItems.map((item)=>{
            if(typeof item === "string"){
                return {
                    itemId:item,
                    active:true,
                    sortOrderId:undefined
                };
            }

            return {
                itemId:item.itemId || item.id,
                active:item.active ?? true,
                sortOrderId:item.sortOrderId === undefined || item.sortOrderId === null ? undefined : Number(item.sortOrderId)
            };
        })
        : [];

    if(normalizedItems.some((item)=>!item.itemId)){
        throw new apiError(400,"each menu item needs an itemId");
    }

    const uniqueItemIds = [...new Set(normalizedItems.map((item)=>String(item.itemId)))];
    if(uniqueItemIds.length !== normalizedItems.length){
        throw new apiError(400,"duplicate menu items are not allowed");
    }

    if(uniqueItemIds.length > 0){
        const itemCount = await prisma.shopItem.count({
            where:{
                id:{
                    in:uniqueItemIds
                },
                shopId,
                active:true
            }
        });

        if(itemCount !== uniqueItemIds.length){
            throw new apiError(404,"one or more selected items were not found for this shop");
        }
    }

    const selectedCombos = Array.isArray(combos) && combos.length > 0 ? combos : comboIds;
    const normalizedCombos = Array.isArray(selectedCombos)
        ? selectedCombos.map((combo)=>{
            if(typeof combo === "string"){
                return {
                    comboId:combo,
                    active:true,
                    sortOrderId:undefined
                };
            }

            return {
                comboId:combo.comboId || combo.id,
                active:combo.active ?? true,
                sortOrderId:combo.sortOrderId === undefined || combo.sortOrderId === null ? undefined : Number(combo.sortOrderId)
            };
        })
        : [];

    if(normalizedCombos.some((combo)=>!combo.comboId)){
        throw new apiError(400,"each menu combo needs a comboId");
    }

    const uniqueComboIds = [...new Set(normalizedCombos.map((combo)=>String(combo.comboId)))];
    if(uniqueComboIds.length !== normalizedCombos.length){
        throw new apiError(400,"duplicate menu combos are not allowed");
    }

    if(uniqueComboIds.length > 0){
        const comboCount = await prisma.combo.count({
            where:{
                id:{
                    in:uniqueComboIds
                },
                shopId,
                active:true
            }
        });

        if(comboCount !== uniqueComboIds.length){
            throw new apiError(404,"one or more selected combos were not found for this shop");
        }
    }

    if(normalizedItems.length === 0 && normalizedCombos.length === 0){
        throw new apiError(400,"menu needs at least one item or combo");
    }

    const menu = await prisma.$transaction(async(tx)=>{
        await reserveShopSlot(tx,shopId);
        return tx.menu.create({
            data:{
                shopId,
                name,
                description,
                active:active ?? true,
                sortOrderId:sortOrderId === undefined || sortOrderId === null ? undefined : Number(sortOrderId),
                schedules:{
                    create:normalizedSchedules
                },
                items:{
                    create:normalizedItems.map((item)=>({
                        itemId:String(item.itemId),
                        active:item.active,
                        sortOrderId:item.sortOrderId
                    }))
                },
                combos:{
                    create:normalizedCombos.map((combo)=>({
                        comboId:String(combo.comboId),
                        active:combo.active,
                        sortOrderId:combo.sortOrderId
                    }))
                }
            },
            select:{
                id:true,
                shopId:true,
                name:true,
                description:true,
                active:true,
                sortOrderId:true,
                createdAt:true,
                updatedAt:true,
                schedules:{
                    select:{
                        id:true,
                        dayOfWeek:true,
                        startMinute:true,
                        endMinute:true,
                        active:true
                    },
                    orderBy:{
                        dayOfWeek:"asc"
                    }
                },
                _count:{
                    select:{
                        items:true,
                        combos:true
                    }
                }
            }
        });
    });

    return res.status(201).json(new apiResponse(201,{
        ...menu,
        itemCount:menu._count.items,
        comboCount:menu._count.combos,
        _count:undefined
    },"menu created successfully"));
});

const editMenu = asyncHandler(async(req,res)=>{
    const {menuId} = req.params;

    if(!menuId) throw new apiError(400,"menu id is required");

    const existingMenu = await prisma.menu.findUnique({
        where:{
            id:menuId
        },
        select:{
            id:true,
            shopId:true,
            name:true,
            shop:{
                select:{
                    id:true,
                    ownerId:true
                }
            }
        }
    });

    if(!existingMenu) throw new apiError(404,"menu not found");

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    if(currentUser.role !== "ADMIN" && existingMenu.shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage menus for your own shop");
    }

    const dataToUpdate = {};

    if(req.body.name !== undefined){
        if(!req.body.name) throw new apiError(400,"menu name cannot be empty");

        const duplicateMenu = await prisma.menu.findFirst({
            where:{
                shopId:existingMenu.shopId,
                id:{
                    not:menuId
                },
                name:{
                    equals:req.body.name,
                    mode:"insensitive"
                }
            }
        });

        if(duplicateMenu) throw new apiError(409,"menu with this name already exists for this shop");

        dataToUpdate.name = req.body.name;
    }

    if(req.body.description !== undefined) dataToUpdate.description = req.body.description;
    if(req.body.active !== undefined) dataToUpdate.active = req.body.active;
    if(req.body.sortOrderId !== undefined) dataToUpdate.sortOrderId = req.body.sortOrderId === null ? null : Number(req.body.sortOrderId);

    if(req.body.schedules !== undefined || req.body.schedule !== undefined || req.body.scheduleType !== undefined || req.body.schedulePreset !== undefined){
        const normalizedSchedules = normalizeMenuSchedules(req.body);
        validateMenuSchedules(normalizedSchedules);

        dataToUpdate.schedules = {
            deleteMany:{},
            create:normalizedSchedules
        };
    }

    if(req.body.items !== undefined || req.body.itemIds !== undefined){
        const selectedItems = Array.isArray(req.body.items) && req.body.items.length > 0 ? req.body.items : req.body.itemIds;

        if(!Array.isArray(selectedItems)){
            throw new apiError(400,"items must be an array");
        }

        const normalizedItems = selectedItems.map((item)=>{
            if(typeof item === "string"){
                return {
                    itemId:item,
                    active:true,
                    sortOrderId:undefined
                };
            }

            return {
                itemId:item.itemId || item.id,
                active:item.active ?? true,
                sortOrderId:item.sortOrderId === undefined || item.sortOrderId === null ? undefined : Number(item.sortOrderId)
            };
        });

        if(normalizedItems.some((item)=>!item.itemId)){
            throw new apiError(400,"each menu item needs an itemId");
        }

        const uniqueItemIds = [...new Set(normalizedItems.map((item)=>String(item.itemId)))];
        if(uniqueItemIds.length !== normalizedItems.length){
            throw new apiError(400,"duplicate menu items are not allowed");
        }

        if(uniqueItemIds.length > 0){
            const itemCount = await prisma.shopItem.count({
                where:{
                    id:{
                        in:uniqueItemIds
                    },
                    shopId:existingMenu.shopId,
                    active:true
                }
            });

            if(itemCount !== uniqueItemIds.length){
                throw new apiError(404,"one or more selected items were not found for this shop");
            }
        }

        dataToUpdate.items = {
            deleteMany:{},
            create:normalizedItems.map((item)=>({
                itemId:String(item.itemId),
                active:item.active,
                sortOrderId:item.sortOrderId
            }))
        };
    }

    if(req.body.combos !== undefined || req.body.comboIds !== undefined){
        const selectedCombos = Array.isArray(req.body.combos) && req.body.combos.length > 0 ? req.body.combos : req.body.comboIds;

        if(!Array.isArray(selectedCombos)){
            throw new apiError(400,"combos must be an array");
        }

        const normalizedCombos = selectedCombos.map((combo)=>{
            if(typeof combo === "string"){
                return {
                    comboId:combo,
                    active:true,
                    sortOrderId:undefined
                };
            }

            return {
                comboId:combo.comboId || combo.id,
                active:combo.active ?? true,
                sortOrderId:combo.sortOrderId === undefined || combo.sortOrderId === null ? undefined : Number(combo.sortOrderId)
            };
        });

        if(normalizedCombos.some((combo)=>!combo.comboId)){
            throw new apiError(400,"each menu combo needs a comboId");
        }

        const uniqueComboIds = [...new Set(normalizedCombos.map((combo)=>String(combo.comboId)))];
        if(uniqueComboIds.length !== normalizedCombos.length){
            throw new apiError(400,"duplicate menu combos are not allowed");
        }

        if(uniqueComboIds.length > 0){
            const comboCount = await prisma.combo.count({
                where:{
                    id:{
                        in:uniqueComboIds
                    },
                    shopId:existingMenu.shopId,
                    active:true
                }
            });

            if(comboCount !== uniqueComboIds.length){
                throw new apiError(404,"one or more selected combos were not found for this shop");
            }
        }

        dataToUpdate.combos = {
            deleteMany:{},
            create:normalizedCombos.map((combo)=>({
                comboId:String(combo.comboId),
                active:combo.active,
                sortOrderId:combo.sortOrderId
            }))
        };
    }

    if(Object.keys(dataToUpdate).length === 0){
        throw new apiError(400,"no menu data passed");
    }

    const updatedMenu = await prisma.menu.update({
        where:{
            id:menuId
        },
        data:dataToUpdate,
        include:{
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true
                }
            },
            schedules:true,
            items:{
                select:{
                    id:true,
                    active:true,
                    sortOrderId:true,
                    item:{
                        select:{
                            id:true,
                            pricing:true,
                            pricingMode:true,
                            unit:true,
                            displayUnit:true,
                            pricePerUnit:true,
                            minOrderQuantity:true,
                            quantityStep:true,
                            availableQuantityValue:true,
                            availableQuantity:true,
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
            },
            combos:{
                select:{
                    id:true,
                    active:true,
                    sortOrderId:true,
                    combo:{
                        select:{
                            id:true,
                            name:true,
                            imageUrl:true,
                            totalPrice:true,
                            availableQuantity:true
                        }
                    }
                }
            }
        }
    });

    return res.status(200).json(new apiResponse(200,updatedMenu,"menu updated successfully"));
});

const deleteMenu = asyncHandler(async(req,res)=>{
    const {menuId} = req.params;

    if(!menuId) throw new apiError(400,"menu id is required");

    const menu = await prisma.menu.findUnique({
        where:{
            id:menuId
        },
        select:{
            id:true,
            shop:{
                select:{
                    id:true,
                    ownerId:true
                }
            }
        }
    });

    if(!menu) throw new apiError(404,"menu not found");

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    if(currentUser.role !== "ADMIN" && menu.shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage menus for your own shop");
    }

    const deletedMenu = await prisma.$transaction(async(tx)=>{
        const deleted = await tx.menu.delete({where:{id:menuId}});
        await releaseShopSlot(tx,menu.shop.id);
        return deleted;
    });

    return res.status(200).json(new apiResponse(200,deletedMenu,"menu deleted successfully"));
});

const reorderMenus = asyncHandler(async(req,res)=>{
    const {shopId,menuIds} = req.body;

    if(!shopId) throw new apiError(400,"shop id is required");
    if(!Array.isArray(menuIds) || menuIds.length === 0){
        throw new apiError(400,"menuIds must be a non-empty array");
    }

    const uniqueMenuIds = [...new Set(menuIds.map((menuId)=>String(menuId)).filter(Boolean))];
    if(uniqueMenuIds.length !== menuIds.length){
        throw new apiError(400,"duplicate menu ids are not allowed");
    }

    const currentUser = await prisma.user.findUnique({
        where:{
            id:req.userData?.id
        },
        select:{
            id:true,
            role:true,
            isBlocked:true
        }
    });

    if(!currentUser || currentUser.isBlocked) throw new apiError(401,"User blocked or unauthorized");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            ownerId:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(currentUser.role !== "ADMIN" && shop.ownerId !== currentUser.id){
        throw new apiError(403,"You can only manage menus for your own shop");
    }

    const menus = await prisma.menu.findMany({
        where:{
            id:{
                in:uniqueMenuIds
            },
            shopId
        },
        select:{
            id:true
        }
    });

    if(menus.length !== uniqueMenuIds.length){
        throw new apiError(400,"one or more menu ids are invalid");
    }

    const updatedMenus = await prisma.$transaction(
        uniqueMenuIds.map((menuId,index)=>{
            return prisma.menu.update({
                where:{
                    id:menuId
                },
                data:{
                    sortOrderId:index + 1
                }
            });
        })
    );

    return res.status(200).json(new apiResponse(200,updatedMenus,"menus reordered successfully"));
});

const fetchRunningMenusByShop = asyncHandler(async(req,res)=>{
    const shopId = req.params.shopId || req.query.shopId;
    const pagination = getPagination(req.query,{defaultLimit:10,maxLimit:30});

    if(!shopId) throw new apiError(400,"shop id is required");

    const shop = await prisma.shop.findUnique({
        where:{
            id:shopId
        },
        select:{
            id:true,
            shopName:true,
            ownerId:true,
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
            }
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(!shopHasFeature(shop,"MENUS")){
        throw new apiError(403,"menus are not enabled for this shop type");
    }

    const {
        dayOfWeek,
        previousDay,
        currentMinute
    } = getCurrentMenuWindow(req.query);

    const cacheKey = `catalog:shop:${shopId}:running-menus:${dayOfWeek}:${currentMinute}:${pagination.page}:${pagination.limit}`;
    const responseData = await getOrSetCachedData(cacheKey,async()=>{
        const menus = await prisma.menu.findMany({
        where:{
            shopId,
            active:true,
            schedules:{
                some:{
                    active:true,
                    dayOfWeek:{
                        in:[dayOfWeek,previousDay]
                    }
                }
            }
        },
        include:{
            shop:{
                select:{
                    id:true,
                    shopName:true,
                    ownerId:true
                }
            },
            schedules:{
                where:{
                    active:true
                },
                orderBy:[
                    {
                        dayOfWeek:"asc"
                    },
                    {
                        startMinute:"asc"
                    }
                ]
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
                    active:true,
                    sortOrderId:true,
                    item:{
                        select:{
                            id:true,
                            pricing:true,
                            pricingMode:true,
                            unit:true,
                            displayUnit:true,
                            pricePerUnit:true,
                            minOrderQuantity:true,
                            quantityStep:true,
                            availableQuantityValue:true,
                            availableQuantity:true,
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
                    active:true,
                    sortOrderId:true,
                    combo:{
                        select:{
                            id:true,
                            name:true,
                            imageUrl:true,
                            totalPrice:true,
                            availableQuantity:true
                        }
                    }
                }
            }
        },
        orderBy:[
            {
                sortOrderId:"asc"
            },
            {
                createdAt:"asc"
            }
        ]
        });

        const runningMenus = menus.filter((menu)=>
            menu.schedules.some((schedule)=>
                isScheduleRunningNow(schedule,dayOfWeek,previousDay,currentMinute)
            )
        );

        const paginatedMenus = runningMenus.slice(pagination.skip,pagination.skip + pagination.limit);
        return {
            shop:{
                id:shop.id,
                shopName:shop.shopName,
                ownerId:shop.ownerId,
                shopType:shop.shopType ? {
                    id:shop.shopType.id,
                    name:shop.shopType.name,
                    slug:shop.shopType.slug,
                    features:shop.shopType.features.map((feature)=>feature.feature)
                } : null
            },
            current:{
                dayOfWeek,
                currentMinute
            },
            pagination:buildPaginationMeta({
                page:pagination.page,
                limit:pagination.limit,
                total:runningMenus.length
            }),
            menus:paginatedMenus.map((menu)=>({
                id:menu.id,
                shopId:menu.shopId,
                name:menu.name,
                description:menu.description,
                active:menu.active,
                sortOrderId:menu.sortOrderId,
                schedules:menu.schedules.map((schedule)=>({
                    id:schedule.id,
                    dayOfWeek:schedule.dayOfWeek,
                    startMinute:schedule.startMinute,
                    endMinute:schedule.endMinute
                })),
                items:menu.items.map((menuItem)=>({
                    id:menuItem.item?.id,
                    menuItemId:menuItem.id,
                    itemId:menuItem.item?.item?.id,
                    name:menuItem.item?.item?.name,
                    pricing:menuItem.item?.pricing,
                    ...formatShopItemPricing(menuItem.item),
                    lowestPrice:calculateShopItemLowestPrice(menuItem.item),
                    hasVariants:hasShopItemVariants(menuItem.item),
                    variantGroups:formatShopItemVariantGroups(menuItem.item?.variantGroups),
                    availableQuantity:menuItem.item?.availableQuantity,
                    imageUrl:menuItem.item?.imageUrl || menuItem.item?.item?.imageUrl || null,
                    description:menuItem.item?.description,
                    sortOrderId:menuItem.sortOrderId,
                    categoryId:menuItem.item?.item?.categoryId || null
                })),
                combos:menu.combos.map((menuCombo)=>({
                    id:menuCombo.combo?.id,
                    menuComboId:menuCombo.id,
                    name:menuCombo.combo?.name,
                    imageUrl:menuCombo.combo?.imageUrl,
                    totalPrice:menuCombo.combo?.totalPrice,
                    availableQuantity:menuCombo.combo?.availableQuantity,
                    sortOrderId:menuCombo.sortOrderId
                }))
            }))
        };
    },30);

    return res.status(200).json(new apiResponse(200,responseData,"running menus fetched successfully"));
});

export { createMenu, editMenu, deleteMenu, reorderMenus, fetchRunningMenusByShop };
