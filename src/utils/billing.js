import { apiError } from "./handler.js";

const BILLING_SETTINGS_ID = "default";

const calculateBpsAmount = (amount,bps)=>Math.round(Number(amount) * Number(bps) / 10000);

const getBillingSettings = async(client)=>{
    const settings = await client.billingSettings.findUnique({
        where:{id:BILLING_SETTINGS_ID}
    });

    return settings || {
        id:BILLING_SETTINGS_ID,
        dailySlotPrice:0,
        commissionBps:0,
        estimationBufferBps:0
    };
};

const reserveShopSlot = async(tx,shopId)=>{
    const reserved = await tx.$queryRaw`
        UPDATE "Shop"
        SET
            "usedSlots" = "usedSlots" + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${shopId}
          AND "billingStatus" NOT IN ('HOLD','PAYMENT_DUE')
          AND "usedSlots" < "totalSlots"
        RETURNING "id","totalSlots","usedSlots","billingStatus"
    `;

    if(reserved.length > 0) return reserved[0];

    const shop = await tx.shop.findUnique({
        where:{id:shopId},
        select:{
            id:true,
            totalSlots:true,
            usedSlots:true,
            billingStatus:true
        }
    });

    if(!shop) throw new apiError(404,"shop not found");
    if(shop.billingStatus === "HOLD" || shop.billingStatus === "PAYMENT_DUE"){
        throw new apiError(402,"shop billing is on hold; recharge balance before adding catalog entries");
    }
    throw new apiError(409,"no slots available; purchase more slots before adding catalog entries");
};

const releaseShopSlot = async(tx,shopId,count = 1)=>{
    const normalizedCount = Math.max(0,Number(count) || 0);
    if(normalizedCount === 0) return;

    await tx.shop.updateMany({
        where:{
            id:shopId,
            usedSlots:{gte:normalizedCount}
        },
        data:{
            usedSlots:{decrement:normalizedCount}
        }
    });
};

const countShopSlotUsage = async(client,shopId)=>{
    const [items,combos,menus] = await Promise.all([
        client.shopItem.count({where:{shopId}}),
        client.combo.count({where:{shopId}}),
        client.menu.count({where:{shopId}})
    ]);

    return {
        items,
        combos,
        menus,
        total:items + combos + menus
    };
};

export {
    BILLING_SETTINGS_ID,
    calculateBpsAmount,
    countShopSlotUsage,
    getBillingSettings,
    releaseShopSlot,
    reserveShopSlot
};
