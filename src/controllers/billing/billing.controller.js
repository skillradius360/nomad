import { prisma } from "../../db/index.js";
import { apiError, apiResponse, asyncHandler } from "../../utils/handler.js";
import { buildPaginationMeta, getPagination } from "../../utils/pagination.js";
import {
    BILLING_SETTINGS_ID,
    calculateBpsAmount,
    countShopSlotUsage,
    getBillingSettings
} from "../../utils/billing.js";

const IST_OFFSET = "+05:30";

const getBillingDayRange = (dateInput)=>{
    const currentIstDate = new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Kolkata"}));
    currentIstDate.setDate(currentIstDate.getDate() - 1);
    const previousIstDate = [
        currentIstDate.getFullYear(),
        String(currentIstDate.getMonth() + 1).padStart(2,"0"),
        String(currentIstDate.getDate()).padStart(2,"0")
    ].join("-");
    const dateString = dateInput || previousIstDate;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dateString)){
        throw new apiError(400,"date must use YYYY-MM-DD format");
    }

    const start = new Date(`${dateString}T00:00:00.000${IST_OFFSET}`);
    if(Number.isNaN(start.getTime())) throw new apiError(400,"invalid billing date");

    return {
        dateString,
        start,
        end:new Date(start.getTime() + 24 * 60 * 60 * 1000),
        billingDate:new Date(`${dateString}T00:00:00.000Z`)
    };
};

const requirePositiveInteger = (value,fieldName,{allowZero = false} = {})=>{
    const parsed = Number(value);
    const minimum = allowZero ? 0 : 1;
    if(!Number.isInteger(parsed) || parsed < minimum){
        throw new apiError(400,`${fieldName} must be an integer of at least ${minimum}`);
    }
    return parsed;
};

const requireShopAccess = async(userId,shopId,{adminOnly = false} = {})=>{
    const [user,shop] = await Promise.all([
        prisma.user.findUnique({
            where:{id:userId},
            select:{id:true,role:true,isBlocked:true}
        }),
        prisma.shop.findUnique({
            where:{id:shopId},
            select:{
                id:true,
                shopName:true,
                ownerId:true,
                shopBalance:true,
                totalSlots:true,
                usedSlots:true,
                billingStatus:true
            }
        })
    ]);

    if(!user || user.isBlocked) throw new apiError(401,"User blocked or unauthorized");
    if(!shop) throw new apiError(404,"shop not found");
    if(adminOnly && user.role !== "ADMIN") throw new apiError(403,"Admin access required");
    if(!adminOnly && user.role !== "ADMIN" && shop.ownerId !== user.id){
        throw new apiError(403,"You can only access billing for your own shop");
    }

    return {user,shop};
};

const getAverageDailyCommission = async(shopId,days = 30)=>{
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const charges = await prisma.orderCommissionCharge.findMany({
        where:{
            shopId,
            completedAt:{gte:since}
        },
        select:{
            commissionAmount:true,
            refundedCommission:true
        }
    });

    const netCommission = charges.reduce((sum,charge)=>{
        return sum + Math.max(0,charge.commissionAmount - charge.refundedCommission);
    },0);

    return Math.round(netCommission / days);
};

const getBillingConfig = asyncHandler(async(req,res)=>{
    const [settings,dayOptions,amountOptions] = await Promise.all([
        getBillingSettings(prisma),
        prisma.rechargeDayOption.findMany({
            where:{active:true},
            orderBy:[{sortOrder:"asc"},{days:"asc"}]
        }),
        prisma.rechargeAmountOption.findMany({
            where:{active:true},
            orderBy:[{sortOrder:"asc"},{amount:"asc"}]
        })
    ]);

    return res.status(200).json(new apiResponse(200,{
        dailySlotPrice:settings.dailySlotPrice,
        commissionPercent:settings.commissionBps / 100,
        estimationBufferPercent:settings.estimationBufferBps / 100,
        dayOptions,
        amountOptions
    },"billing configuration fetched successfully"));
});

const updateBillingConfig = asyncHandler(async(req,res)=>{
    const dailySlotPrice = requirePositiveInteger(req.body.dailySlotPrice,"dailySlotPrice",{allowZero:true});
    const commissionPercent = Number(req.body.commissionPercent);
    const estimationBufferPercent = Number(req.body.estimationBufferPercent ?? 0);

    if(!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100){
        throw new apiError(400,"commissionPercent must be between 0 and 100");
    }
    if(!Number.isFinite(estimationBufferPercent) || estimationBufferPercent < 0 || estimationBufferPercent > 100){
        throw new apiError(400,"estimationBufferPercent must be between 0 and 100");
    }

    const settings = await prisma.billingSettings.upsert({
        where:{id:BILLING_SETTINGS_ID},
        update:{
            dailySlotPrice,
            commissionBps:Math.round(commissionPercent * 100),
            estimationBufferBps:Math.round(estimationBufferPercent * 100),
            updatedById:req.userData?.id
        },
        create:{
            id:BILLING_SETTINGS_ID,
            dailySlotPrice,
            commissionBps:Math.round(commissionPercent * 100),
            estimationBufferBps:Math.round(estimationBufferPercent * 100),
            updatedById:req.userData?.id
        }
    });

    return res.status(200).json(new apiResponse(200,{
        dailySlotPrice:settings.dailySlotPrice,
        commissionPercent:settings.commissionBps / 100,
        estimationBufferPercent:settings.estimationBufferBps / 100
    },"billing configuration updated successfully"));
});

const createRechargeDayOption = asyncHandler(async(req,res)=>{
    const days = requirePositiveInteger(req.body.days,"days");
    const option = await prisma.rechargeDayOption.upsert({
        where:{days},
        update:{
            active:req.body.active ?? true,
            sortOrder:Number(req.body.sortOrder ?? 0)
        },
        create:{
            days,
            active:req.body.active ?? true,
            sortOrder:Number(req.body.sortOrder ?? 0)
        }
    });
    return res.status(201).json(new apiResponse(201,option,"recharge day option saved successfully"));
});

const createRechargeAmountOption = asyncHandler(async(req,res)=>{
    const amount = requirePositiveInteger(req.body.amount,"amount");
    const option = await prisma.rechargeAmountOption.upsert({
        where:{amount},
        update:{
            active:req.body.active ?? true,
            sortOrder:Number(req.body.sortOrder ?? 0)
        },
        create:{
            amount,
            active:req.body.active ?? true,
            sortOrder:Number(req.body.sortOrder ?? 0)
        }
    });
    return res.status(201).json(new apiResponse(201,option,"recharge amount option saved successfully"));
});

const deleteRechargeDayOption = asyncHandler(async(req,res)=>{
    await prisma.rechargeDayOption.delete({where:{id:req.params.optionId}});
    return res.status(200).json(new apiResponse(200,{id:req.params.optionId},"recharge day option deleted successfully"));
});

const deleteRechargeAmountOption = asyncHandler(async(req,res)=>{
    await prisma.rechargeAmountOption.delete({where:{id:req.params.optionId}});
    return res.status(200).json(new apiResponse(200,{id:req.params.optionId},"recharge amount option deleted successfully"));
});

const getShopBillingSummary = asyncHandler(async(req,res)=>{
    const {shop} = await requireShopAccess(req.userData?.id,req.params.shopId);
    const additionalSlots = requirePositiveInteger(req.query.additionalSlots ?? 0,"additionalSlots",{allowZero:true});
    const [settings,usage,averageDailyCommission,pendingCommissions,pendingAdjustments,dayOptions] = await Promise.all([
        getBillingSettings(prisma),
        countShopSlotUsage(prisma,shop.id),
        getAverageDailyCommission(shop.id),
        prisma.orderCommissionCharge.aggregate({
            where:{shopId:shop.id,status:"PENDING"},
            _sum:{commissionAmount:true}
        }),
        prisma.orderCommissionCharge.aggregate({
            where:{shopId:shop.id,pendingAdjustment:{gt:0}},
            _sum:{pendingAdjustment:true}
        }),
        prisma.rechargeDayOption.findMany({
            where:{active:true},
            orderBy:[{sortOrder:"asc"},{days:"asc"}]
        })
    ]);

    const dailySlotCharge = shop.totalSlots * settings.dailySlotPrice;
    const accruedCommission = Math.max(0,
        Number(pendingCommissions._sum.commissionAmount || 0) - Number(pendingAdjustments._sum.pendingAdjustment || 0)
    );
    const projectedTotalSlots = shop.totalSlots + additionalSlots;
    const projectedDailySlotCharge = projectedTotalSlots * settings.dailySlotPrice;
    const commissionBuffer = calculateBpsAmount(averageDailyCommission,settings.estimationBufferBps);
    const projectedDailyCost = projectedDailySlotCharge + averageDailyCommission + commissionBuffer;

    return res.status(200).json(new apiResponse(200,{
        shop:{id:shop.id,shopName:shop.shopName,billingStatus:shop.billingStatus},
        balance:shop.shopBalance,
        slots:{
            total:shop.totalSlots,
            used:usage.total,
            available:Math.max(shop.totalSlots - usage.total,0),
            breakdown:{items:usage.items,combos:usage.combos,menus:usage.menus}
        },
        pricing:{
            dailySlotPrice:settings.dailySlotPrice,
            commissionPercent:settings.commissionBps / 100
        },
        dailyEstimate:{
            slotCharge:dailySlotCharge,
            averageOrderCommission:averageDailyCommission,
            estimatedTotal:dailySlotCharge + averageDailyCommission
        },
        rechargeEstimate:{
            additionalSlots,
            projectedTotalSlots,
            projectedDailySlotCharge,
            averageDailyCommission,
            commissionBuffer,
            projectedDailyCost,
            suggestions:dayOptions.map((option)=>(
                {
                    dayOptionId:option.id,
                    days:option.days,
                    suggestedAmount:Math.max(0,projectedDailyCost * option.days - shop.shopBalance)
                }
            ))
        },
        accruedToday:{
            slotCharge:dailySlotCharge,
            orderCommission:accruedCommission,
            total:dailySlotCharge + accruedCommission,
            availableBalance:shop.shopBalance - dailySlotCharge - accruedCommission
        }
    },"shop billing summary fetched successfully"));
});

const getShopRevenueOverview = asyncHandler(async(req,res)=>{
    const {shop} = await requireShopAccess(req.userData?.id,req.params.shopId,{adminOnly:true});

    const [usage,orders,billing] = await Promise.all([
        countShopSlotUsage(prisma,shop.id),
        prisma.order.aggregate({
            where:{
                shopId:shop.id,
                currentOrderStatus:"DONE"
            },
            _count:{id:true},
            _sum:{
                totalAmount:true,
                paidAmount:true,
                refundAmount:true
            }
        }),
        prisma.shopDailyBilling.aggregate({
            where:{shopId:shop.id},
            _sum:{totalCharge:true}
        })
    ]);

    const paidAmount = Number(orders._sum.paidAmount || 0);
    const refundAmount = Number(orders._sum.refundAmount || 0);

    return res.status(200).json(new apiResponse(200,{
        shopId:shop.id,
        shopName:shop.shopName,
        totalSlotsLeft:Math.max(shop.totalSlots - usage.total,0),
        totalOrdersExecuted:orders._count.id || 0,
        totalMoneyGenerated:Number(orders._sum.totalAmount || 0),
        shopRevenue:paidAmount - refundAmount,
        companyRevenue:Number(billing._sum.totalCharge || 0)
    },"shop revenue overview fetched successfully"));
});

const createRechargeRequest = asyncHandler(async(req,res)=>{
    const {shopId,dayOptionId,amountOptionId,paymentReference} = req.body;
    const requestedSlots = requirePositiveInteger(req.body.requestedSlots ?? 0,"requestedSlots",{allowZero:true});
    if(!shopId) throw new apiError(400,"shopId is required");
    if(Boolean(dayOptionId) === Boolean(amountOptionId)){
        throw new apiError(400,"select either one day option or one amount option");
    }
    if(req.body.paymentTransferDone !== true){
        throw new apiError(400,"paymentTransferDone must be true before submitting recharge");
    }

    const {user,shop} = await requireShopAccess(req.userData?.id,shopId);
    if(user.role !== "SELLER") throw new apiError(403,"Seller access required");

    const [settings,dayOption,amountOption,averageDailyCommission] = await Promise.all([
        getBillingSettings(prisma),
        dayOptionId ? prisma.rechargeDayOption.findFirst({where:{id:dayOptionId,active:true}}) : null,
        amountOptionId ? prisma.rechargeAmountOption.findFirst({where:{id:amountOptionId,active:true}}) : null,
        getAverageDailyCommission(shop.id)
    ]);

    if(dayOptionId && !dayOption) throw new apiError(400,"invalid or inactive recharge day option");
    if(amountOptionId && !amountOption) throw new apiError(400,"invalid or inactive recharge amount option");

    const newTotalSlots = shop.totalSlots + requestedSlots;
    const dailySlotCharge = newTotalSlots * settings.dailySlotPrice;
    const commissionBuffer = calculateBpsAmount(averageDailyCommission,settings.estimationBufferBps);
    const estimatedDailyCost = dailySlotCharge + averageDailyCommission + commissionBuffer;
    const suggestedAmount = dayOption
        ? Math.max(0,estimatedDailyCost * dayOption.days - shop.shopBalance)
        : amountOption.amount;

    if(suggestedAmount <= 0 && requestedSlots === 0){
        throw new apiError(400,"shop balance already covers the selected estimate");
    }

    const recharge = await prisma.recharges.create({
        data:{
            userId:user.id,
            shopId:shop.id,
            orderAmount:suggestedAmount,
            requestedSlots,
            requestedDays:dayOption?.days,
            slotPriceSnapshot:settings.dailySlotPrice,
            commissionBpsSnapshot:settings.commissionBps,
            estimatedDailyCommission:averageDailyCommission,
            paymentTransferDone:true,
            paymentReference
        },
        select:{
            id:true,
            shopId:true,
            orderAmount:true,
            requestedSlots:true,
            requestedDays:true,
            status:true,
            createdAt:true
        }
    });

    return res.status(201).json(new apiResponse(201,{
        ...recharge,
        calculation:{
            totalSlotsAfterApproval:newTotalSlots,
            dailySlotCharge,
            averageDailyCommission,
            commissionBuffer,
            estimatedDailyCost,
            currentBalance:shop.shopBalance
        }
    },"recharge request submitted for admin approval"));
});

const listMyRechargeRequests = asyncHandler(async(req,res)=>{
    const {shopId} = req.query;
    if(!shopId) throw new apiError(400,"shopId is required");
    await requireShopAccess(req.userData?.id,shopId);
    const pagination = getPagination(req.query);
    const where = {shopId,userId:req.userData?.id};
    const [recharges,total] = await Promise.all([
        prisma.recharges.findMany({
            where,
            orderBy:{createdAt:"desc"},
            skip:pagination.skip,
            take:pagination.take
        }),
        prisma.recharges.count({where})
    ]);
    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({page:pagination.page,limit:pagination.limit,total}),
        recharges
    },"recharge requests fetched successfully"));
});

const listRechargeRequests = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query);
    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    if(status && !["PENDING","APPROVED","REJECTED"].includes(status)){
        throw new apiError(400,"invalid recharge status");
    }
    const where = status ? {status} : {};
    const [recharges,total] = await Promise.all([
        prisma.recharges.findMany({
            where,
            orderBy:{createdAt:"desc"},
            skip:pagination.skip,
            take:pagination.take,
            select:{
                id:true,orderAmount:true,requestedSlots:true,requestedDays:true,status:true,
                paymentTransferDone:true,paymentReference:true,createdAt:true,approvedAt:true,rejectedAt:true,
                user:{select:{id:true,name:true,phone:true}},
                shop:{select:{id:true,shopName:true,shopBalance:true,totalSlots:true,usedSlots:true}}
            }
        }),
        prisma.recharges.count({where})
    ]);
    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({page:pagination.page,limit:pagination.limit,total}),
        recharges
    },"recharge requests fetched successfully"));
});

const reviewRechargeRequest = asyncHandler(async(req,res)=>{
    const action = String(req.body.action || "").toUpperCase();
    if(!["APPROVE","REJECT"].includes(action)) throw new apiError(400,"action must be APPROVE or REJECT");

    const result = await prisma.$transaction(async(tx)=>{
        const recharge = await tx.recharges.findUnique({where:{id:req.params.rechargeId}});
        if(!recharge) throw new apiError(404,"recharge request not found");
        if(recharge.status !== "PENDING") throw new apiError(409,"recharge request has already been reviewed");

        if(action === "REJECT"){
            const claimed = await tx.recharges.updateMany({
                where:{id:recharge.id,status:"PENDING"},
                data:{status:"REJECTED",rejectedAt:new Date()}
            });
            if(claimed.count !== 1) throw new apiError(409,"recharge request has already been reviewed");
            return tx.recharges.findUnique({where:{id:recharge.id}});
        }
        if(!recharge.paymentTransferDone) throw new apiError(400,"payment transfer is not marked complete");

        const claimed = await tx.recharges.updateMany({
            where:{id:recharge.id,status:"PENDING"},
            data:{status:"APPROVED",approvedAt:new Date()}
        });
        if(claimed.count !== 1) throw new apiError(409,"recharge request has already been reviewed");

        const shop = await tx.shop.findUnique({
            where:{id:recharge.shopId},
            select:{shopBalance:true,totalSlots:true}
        });
        if(!shop) throw new apiError(404,"shop not found");

        const closingBalance = shop.shopBalance + recharge.orderAmount;
        const updatedShop = await tx.shop.update({
            where:{id:recharge.shopId},
            data:{
                shopBalance:closingBalance,
                totalSlots:{increment:recharge.requestedSlots},
                billingStatus:closingBalance > 0 ? "ACTIVE" : "HOLD"
            },
            select:{id:true,shopBalance:true,totalSlots:true,usedSlots:true,billingStatus:true}
        });

        const updatedRecharge = await tx.recharges.findUnique({where:{id:recharge.id}});

        await tx.shopBillingLedger.create({
            data:{
                shopId:recharge.shopId,
                entryType:"RECHARGE",
                amount:recharge.orderAmount,
                balanceAfter:closingBalance,
                referenceKey:`recharge:${recharge.id}`,
                description:`Recharge approved with ${recharge.requestedSlots} additional slots`
            }
        });

        return {recharge:updatedRecharge,shop:updatedShop};
    });

    const actionMessage = action === "APPROVE" ? "approved" : "rejected";
    return res.status(200).json(new apiResponse(200,result,`recharge request ${actionMessage} successfully`));
});

const syncShopSlots = asyncHandler(async(req,res)=>{
    const {shop} = await requireShopAccess(req.userData?.id,req.params.shopId,{adminOnly:true});
    const usage = await countShopSlotUsage(prisma,shop.id);
    const grantMissingSlots = req.body.grantMissingSlots !== false;
    const totalSlots = grantMissingSlots ? Math.max(shop.totalSlots,usage.total) : shop.totalSlots;
    if(totalSlots < usage.total) throw new apiError(409,"total slots cannot be lower than current usage");

    const updatedShop = await prisma.shop.update({
        where:{id:shop.id},
        data:{usedSlots:usage.total,totalSlots},
        select:{id:true,shopName:true,totalSlots:true,usedSlots:true,shopBalance:true,billingStatus:true}
    });

    return res.status(200).json(new apiResponse(200,{
        shop:updatedShop,
        usage
    },"shop slot counters synchronized successfully"));
});

const executeDailyBilling = async(dateInput)=>{
    const {end,billingDate,dateString} = getBillingDayRange(dateInput);
    const settings = await getBillingSettings(prisma);
    const shops = await prisma.shop.findMany({
        where:{
            OR:[
                {totalSlots:{gt:0}},
                {orderCommissions:{some:{OR:[{status:"PENDING"},{pendingAdjustment:{gt:0}}]}}}
            ]
        },
        select:{id:true}
    });

    const results = [];
    for(const shopRef of shops){
        let settled;
        try{
            settled = await prisma.$transaction(async(tx)=>{
            const existing = await tx.shopDailyBilling.findUnique({
                where:{shopId_billingDate:{shopId:shopRef.id,billingDate}}
            });
            if(existing) return {shopId:shopRef.id,status:"SKIPPED",reason:"already settled"};

            const shop = await tx.shop.findUnique({
                where:{id:shopRef.id},
                select:{id:true,shopBalance:true,totalSlots:true}
            });
            if(!shop) return {shopId:shopRef.id,status:"SKIPPED",reason:"shop not found"};

            const [pendingCharges,adjustmentCharges] = await Promise.all([
                tx.orderCommissionCharge.findMany({
                    where:{shopId:shop.id,status:"PENDING",completedAt:{lt:end}},
                    select:{id:true,orderValue:true,commissionAmount:true}
                }),
                tx.orderCommissionCharge.findMany({
                    where:{shopId:shop.id,pendingAdjustment:{gt:0}},
                    select:{id:true,pendingAdjustment:true}
                })
            ]);

            const completedOrderValue = pendingCharges.reduce((sum,row)=>sum + row.orderValue,0);
            const commissionCharge = pendingCharges.reduce((sum,row)=>sum + row.commissionAmount,0);
            const commissionRefundAdjustment = adjustmentCharges.reduce((sum,row)=>sum + row.pendingAdjustment,0);
            const slotCharge = shop.totalSlots * settings.dailySlotPrice;
            const totalCharge = slotCharge + commissionCharge - commissionRefundAdjustment;
            const closingBalance = shop.shopBalance - totalCharge;

            const dailyBilling = await tx.shopDailyBilling.create({
                data:{
                    shopId:shop.id,
                    billingDate,
                    totalSlots:shop.totalSlots,
                    dailySlotPrice:settings.dailySlotPrice,
                    slotCharge,
                    completedOrderValue,
                    commissionBps:settings.commissionBps,
                    commissionCharge,
                    commissionRefundAdjustment,
                    totalCharge,
                    openingBalance:shop.shopBalance,
                    closingBalance
                }
            });

            await tx.shop.update({
                where:{id:shop.id},
                data:{
                    shopBalance:closingBalance,
                    billingStatus:closingBalance > 0 ? "ACTIVE" : "HOLD"
                }
            });

            if(pendingCharges.length > 0){
                await tx.orderCommissionCharge.updateMany({
                    where:{id:{in:pendingCharges.map((row)=>row.id)},status:"PENDING"},
                    data:{status:"SETTLED",settledAt:new Date()}
                });
            }
            if(adjustmentCharges.length > 0){
                for(const adjustment of adjustmentCharges){
                    await tx.orderCommissionCharge.update({
                        where:{id:adjustment.id},
                        data:{pendingAdjustment:0}
                    });
                }
            }

            await tx.shopBillingLedger.create({
                data:{
                    shopId:shop.id,
                    entryType:"DAILY_CHARGE",
                    amount:-totalCharge,
                    balanceAfter:closingBalance,
                    referenceKey:`daily:${shop.id}:${dateString}`,
                    description:`Daily slot and completed-order settlement for ${dateString}`
                }
            });

            await tx.companyRevenueDaily.upsert({
                where:{revenueDate:billingDate},
                update:{
                    slotRevenue:{increment:slotCharge},
                    orderCommissionRevenue:{increment:commissionCharge},
                    commissionRefundAdjustments:{increment:commissionRefundAdjustment},
                    totalRevenue:{increment:totalCharge}
                },
                create:{
                    revenueDate:billingDate,
                    slotRevenue:slotCharge,
                    orderCommissionRevenue:commissionCharge,
                    commissionRefundAdjustments:commissionRefundAdjustment,
                    totalRevenue:totalCharge
                }
            });

                return {shopId:shop.id,status:"SETTLED",dailyBilling};
            });
        }catch(error){
            if(error?.code !== "P2002") throw error;
            settled = {shopId:shopRef.id,status:"SKIPPED",reason:"already settled"};
        }
        results.push(settled);
    }

    return {
        billingDate:dateString,
        settled:results.filter((row)=>row.status === "SETTLED").length,
        skipped:results.filter((row)=>row.status === "SKIPPED").length,
        results
    };
};

const runDailyBilling = asyncHandler(async(req,res)=>{
    const result = await executeDailyBilling(req.body.date || req.query.date);
    return res.status(200).json(new apiResponse(200,result,"daily billing run completed"));
});

const getShopBillingLedger = asyncHandler(async(req,res)=>{
    await requireShopAccess(req.userData?.id,req.params.shopId);
    const pagination = getPagination(req.query);
    const where = {shopId:req.params.shopId};
    const [entries,total] = await Promise.all([
        prisma.shopBillingLedger.findMany({
            where,
            orderBy:{occurredAt:"desc"},
            skip:pagination.skip,
            take:pagination.take
        }),
        prisma.shopBillingLedger.count({where})
    ]);
    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({page:pagination.page,limit:pagination.limit,total}),
        entries
    },"shop billing ledger fetched successfully"));
});

const getCompanyRevenue = asyncHandler(async(req,res)=>{
    const pagination = getPagination(req.query,{defaultLimit:30,maxLimit:100});
    const where = {};
    if(req.query.from || req.query.to){
        where.revenueDate = {};
        if(req.query.from) where.revenueDate.gte = new Date(`${req.query.from}T00:00:00.000Z`);
        if(req.query.to) where.revenueDate.lte = new Date(`${req.query.to}T00:00:00.000Z`);
    }
    const [days,total,totals] = await Promise.all([
        prisma.companyRevenueDaily.findMany({
            where,
            orderBy:{revenueDate:"desc"},
            skip:pagination.skip,
            take:pagination.take
        }),
        prisma.companyRevenueDaily.count({where}),
        prisma.companyRevenueDaily.aggregate({
            where,
            _sum:{slotRevenue:true,orderCommissionRevenue:true,commissionRefundAdjustments:true,totalRevenue:true}
        })
    ]);
    return res.status(200).json(new apiResponse(200,{
        pagination:buildPaginationMeta({page:pagination.page,limit:pagination.limit,total}),
        totals:totals._sum,
        days
    },"company revenue fetched successfully"));
});

export {
    createRechargeAmountOption,
    createRechargeDayOption,
    createRechargeRequest,
    deleteRechargeAmountOption,
    deleteRechargeDayOption,
    executeDailyBilling,
    getBillingConfig,
    getCompanyRevenue,
    getShopBillingLedger,
    getShopRevenueOverview,
    getShopBillingSummary,
    listMyRechargeRequests,
    listRechargeRequests,
    reviewRechargeRequest,
    runDailyBilling,
    syncShopSlots,
    updateBillingConfig
};
