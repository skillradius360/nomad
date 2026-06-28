import { apiError } from "./handler.js";

const VALID_SHOP_ITEM_PRICING_MODES = ["FIXED","MEASURED"];
const VALID_SHOP_ITEM_UNITS = ["KG","GRAM","LITRE","ML","PIECE","DOZEN","PACK","BUNCH","BOX","CUSTOM"];

const shopItemVariantSelect = {
    id:true,
    name:true,
    required:true,
    minSelect:true,
    maxSelect:true,
    sortOrder:true,
    active:true,
    options:{
        orderBy:{sortOrder:"asc"},
        select:{
            id:true,
            label:true,
            subLabel:true,
            amount:true,
            sortOrder:true,
            active:true
        }
    }
};

const shopItemPricingSelect = {
    pricingMode:true,
    unit:true,
    displayUnit:true,
    pricePerUnit:true,
    minOrderQuantity:true,
    quantityStep:true,
    availableQuantityValue:true
};

const parseOptionalPositiveNumber = (value,fieldName,{allowZero = false} = {})=>{
    if(value === undefined || value === null || value === "") return null;
    const numberValue = Number(value);
    const minimum = allowZero ? 0 : 0;
    if(!Number.isFinite(numberValue) || numberValue < minimum || (!allowZero && numberValue === 0)){
        throw new apiError(400,`${fieldName} must be a ${allowZero ? "non-negative" : "positive"} number`);
    }
    return numberValue;
};

const normalizeShopItemPricingInput = (body,{creating = false} = {})=>{
    const requestedMode = body.pricingMode === undefined || body.pricingMode === null || body.pricingMode === ""
        ? undefined
        : String(body.pricingMode).trim().toUpperCase();

    if(requestedMode && !VALID_SHOP_ITEM_PRICING_MODES.includes(requestedMode)){
        throw new apiError(400,"pricingMode must be FIXED or MEASURED");
    }

    const pricingMode = requestedMode || (creating ? "FIXED" : undefined);
    const data = {};

    if(pricingMode) data.pricingMode = pricingMode;

    if(pricingMode === "MEASURED"){
        const unit = body.unit === undefined || body.unit === null || body.unit === ""
            ? undefined
            : String(body.unit).trim().toUpperCase();
        if(!unit || !VALID_SHOP_ITEM_UNITS.includes(unit)){
            throw new apiError(400,`unit must be one of ${VALID_SHOP_ITEM_UNITS.join(", ")}`);
        }

        const pricePerUnit = parseOptionalPositiveNumber(body.pricePerUnit ?? body.pricing,"pricePerUnit");
        if(pricePerUnit === null) throw new apiError(400,"pricePerUnit is required for measured items");

        const minOrderQuantity = parseOptionalPositiveNumber(body.minOrderQuantity ?? body.minQuantity ?? 1,"minOrderQuantity");
        const quantityStep = parseOptionalPositiveNumber(body.quantityStep ?? body.step ?? minOrderQuantity,"quantityStep");
        const availableQuantityValue = parseOptionalPositiveNumber(
            body.availableQuantityValue ?? body.availableQuantity,
            "availableQuantityValue",
            {allowZero:true}
        );

        data.pricing = String(Math.round(pricePerUnit));
        data.unit = unit;
        data.displayUnit = body.displayUnit === undefined || body.displayUnit === null || body.displayUnit === ""
            ? unit.toLowerCase()
            : String(body.displayUnit).trim();
        data.pricePerUnit = pricePerUnit;
        data.minOrderQuantity = minOrderQuantity;
        data.quantityStep = quantityStep;
        data.availableQuantityValue = availableQuantityValue;
        data.availableQuantity = null;
    }

    if(pricingMode === "FIXED"){
        data.unit = null;
        data.displayUnit = null;
        data.pricePerUnit = null;
        data.minOrderQuantity = null;
        data.quantityStep = null;
        data.availableQuantityValue = null;
    }

    if(!pricingMode && !creating){
        if(body.unit !== undefined) data.unit = body.unit === null || body.unit === "" ? null : String(body.unit).trim().toUpperCase();
        if(body.displayUnit !== undefined) data.displayUnit = body.displayUnit === null || body.displayUnit === "" ? null : String(body.displayUnit).trim();
        if(body.pricePerUnit !== undefined) data.pricePerUnit = parseOptionalPositiveNumber(body.pricePerUnit,"pricePerUnit");
        if(body.minOrderQuantity !== undefined) data.minOrderQuantity = parseOptionalPositiveNumber(body.minOrderQuantity,"minOrderQuantity");
        if(body.quantityStep !== undefined) data.quantityStep = parseOptionalPositiveNumber(body.quantityStep,"quantityStep");
        if(body.availableQuantityValue !== undefined) data.availableQuantityValue = parseOptionalPositiveNumber(body.availableQuantityValue,"availableQuantityValue",{allowZero:true});
    }

    return data;
};

const getShopItemPricingMode = (shopItem)=>String(shopItem?.pricingMode || "FIXED").toUpperCase();

const formatShopItemVariantGroups = (variantGroups = [])=>variantGroups.map((group)=>({
    id:group.id,
    name:group.name,
    required:group.required,
    minSelect:group.minSelect,
    maxSelect:group.maxSelect,
    sortOrder:group.sortOrder,
    active:group.active,
    options:group.options?.map((option)=>({
        id:option.id,
        label:option.label,
        subLabel:option.subLabel,
        amount:option.amount,
        sortOrder:option.sortOrder,
        active:option.active
    })) || []
}));

const calculateShopItemLowestPrice = (shopItem)=>{
    if(getShopItemPricingMode(shopItem) === "MEASURED"){
        const pricePerUnit = Number(shopItem?.pricePerUnit);
        const minQuantity = Number(shopItem?.minOrderQuantity || shopItem?.quantityStep || 1);
        if(!Number.isFinite(pricePerUnit) || pricePerUnit < 0 || !Number.isFinite(minQuantity) || minQuantity <= 0) return 0;
        return Math.max(0,Math.round(pricePerUnit * minQuantity));
    }

    const basePrice = Number(shopItem?.pricing);
    if(!Number.isFinite(basePrice) || basePrice < 0) return 0;

    const variantAmount = (shopItem.variantGroups || []).reduce((total,group)=>{
        if(!group.active) return total;

        const activeAmounts = (group.options || [])
            .filter((option)=>option.active)
            .map((option)=>Number(option.amount))
            .filter((amount)=>Number.isFinite(amount) && amount >= 0)
            .sort((first,second)=>first - second);
        const minSelect = Math.max(Number(group.minSelect || 0),group.required ? 1 : 0);

        if(minSelect <= 0 || activeAmounts.length === 0) return total;
        return total + activeAmounts.slice(0,minSelect).reduce((sum,amount)=>sum + amount,0);
    },0);

    return Math.max(0,Math.round(basePrice + variantAmount));
};

const hasShopItemVariants = (shopItem)=>shopItem?.variantGroups?.some((group)=>
    group.active && group.options?.some((option)=>option.active)
) || false;

const formatShopItemPricing = (shopItem)=>({
    pricingMode:getShopItemPricingMode(shopItem),
    unit:shopItem?.unit || null,
    displayUnit:shopItem?.displayUnit || null,
    pricePerUnit:shopItem?.pricePerUnit ?? null,
    minOrderQuantity:shopItem?.minOrderQuantity ?? null,
    quantityStep:shopItem?.quantityStep ?? null,
    availableQuantityValue:shopItem?.availableQuantityValue ?? null
});

const normalizeMeasuredQuantity = (shopItem,rawQuantityValue)=>{
    const quantityValue = Number(rawQuantityValue);
    if(!Number.isFinite(quantityValue) || quantityValue <= 0){
        throw new apiError(400,`${shopItem.item?.name || "item"} quantityValue must be a positive number`);
    }

    const minOrderQuantity = Number(shopItem.minOrderQuantity || shopItem.quantityStep || 1);
    const quantityStep = Number(shopItem.quantityStep || minOrderQuantity || 1);
    if(quantityValue < minOrderQuantity){
        throw new apiError(400,`${shopItem.item?.name || "item"} minimum order quantity is ${minOrderQuantity}`);
    }

    const stepCount = Math.round((quantityValue - minOrderQuantity) / quantityStep);
    const expectedQuantity = minOrderQuantity + stepCount * quantityStep;
    if(Math.abs(expectedQuantity - quantityValue) > 0.000001){
        throw new apiError(400,`${shopItem.item?.name || "item"} quantityValue must follow step ${quantityStep}`);
    }

    return Number(quantityValue.toFixed(3));
};

const parseVariantOptionIds = (value)=>{
    if(value === undefined || value === null || value === "") return [];
    if(Array.isArray(value)) return value.map(String).filter(Boolean);
    if(typeof value === "string"){
        const trimmedValue = value.trim();
        if(!trimmedValue) return [];
        if(trimmedValue.startsWith("[")){
            try{
                const parsed = JSON.parse(trimmedValue);
                if(!Array.isArray(parsed)) throw new Error("variant option ids must be an array");
                return parsed.map(String).filter(Boolean);
            }catch{
                throw new apiError(400,"variantOptionIds must be a valid JSON array");
            }
        }
        return trimmedValue.split(",").map((id)=>id.trim()).filter(Boolean);
    }
    throw new apiError(400,"variantOptionIds must be an array");
};

const resolveSelectedItemVariants = (shopItem,selectedOptionIds)=>{
    const variantGroups = shopItem.variantGroups || [];
    const uniqueOptionIds = [...new Set(selectedOptionIds.map(String).filter(Boolean))];
    if(uniqueOptionIds.length !== selectedOptionIds.length){
        throw new apiError(400,`${shopItem.item?.name || "item"} has duplicate selected variants`);
    }

    const selectedIdSet = new Set(uniqueOptionIds);
    const selectedOptions = [];

    for(const group of variantGroups){
        if(!group.active) continue;

        const activeOptions = (group.options || []).filter((option)=>option.active);
        const groupSelectedOptions = activeOptions.filter((option)=>selectedIdSet.has(option.id));
        groupSelectedOptions.forEach((option)=>selectedIdSet.delete(option.id));

        const minSelect = Math.max(Number(group.minSelect || 0),group.required ? 1 : 0);
        if(groupSelectedOptions.length < minSelect){
            throw new apiError(400,`${shopItem.item?.name || "item"} requires ${group.name}`);
        }
        if(groupSelectedOptions.length > group.maxSelect){
            throw new apiError(400,`${group.name} allows at most ${group.maxSelect} option(s)`);
        }

        selectedOptions.push(...groupSelectedOptions.map((option)=>({
            groupId:group.id,
            groupName:group.name,
            optionId:option.id,
            label:option.label,
            subLabel:option.subLabel,
            amount:option.amount
        })));
    }

    if(selectedIdSet.size > 0){
        throw new apiError(400,`${shopItem.item?.name || "item"} has invalid selected variants`);
    }

    return selectedOptions;
};

export {
    calculateShopItemLowestPrice,
    formatShopItemVariantGroups,
    formatShopItemPricing,
    getShopItemPricingMode,
    hasShopItemVariants,
    normalizeMeasuredQuantity,
    normalizeShopItemPricingInput,
    parseVariantOptionIds,
    resolveSelectedItemVariants,
    shopItemPricingSelect,
    shopItemVariantSelect
};
