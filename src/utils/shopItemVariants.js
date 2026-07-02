import { apiError } from "./handler.js";

const VALID_SHOP_ITEM_UNITS = ["KG","GRAM","LITRE","ML","PIECE","DOZEN","PACK","BUNCH","BOX","CUSTOM"];
const VALID_VARIANT_PACKAGING_TYPES = ["LOOSE","PACKAGED","CUSTOM"];

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
            price:true,
            packagingType:true,
            unit:true,
            displayUnit:true,
            quantityValue:true,
            minOrderQuantity:true,
            maxOrderQuantity:true,
            quantityStep:true,
            allowCustomQuantity:true,
            availableQuantity:true,
            availableQuantityValue:true,
            sortOrder:true,
            active:true
        }
    }
};

const shopItemPricingSelect = {};

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

    if(requestedMode && requestedMode !== "FIXED"){
        throw new apiError(400,"measured pricing has been removed; use variant options for loose or packaged pricing");
    }

    const pricingMode = requestedMode || (creating ? "FIXED" : undefined);
    const data = {};

    if(pricingMode) data.pricingMode = pricingMode;

    if(pricingMode === "FIXED"){
        data.unit = null;
        data.displayUnit = null;
        data.pricePerUnit = null;
        data.minOrderQuantity = null;
        data.quantityStep = null;
        data.availableQuantityValue = null;
    }

    return data;
};

const getShopItemPricingMode = ()=>"FIXED";

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
        price:option.price ?? null,
        packagingType:option.packagingType || null,
        unit:option.unit || null,
        displayUnit:option.displayUnit || null,
        quantityValue:option.quantityValue ?? null,
        minOrderQuantity:option.minOrderQuantity ?? null,
        maxOrderQuantity:option.maxOrderQuantity ?? null,
        quantityStep:option.quantityStep ?? null,
        allowCustomQuantity:option.allowCustomQuantity ?? false,
        availableQuantity:option.availableQuantity ?? null,
        availableQuantityValue:option.availableQuantityValue ?? null,
        sortOrder:option.sortOrder,
        active:option.active
    })) || []
}));

const calculateShopItemLowestPrice = (shopItem)=>{
    const basePrice = Number(shopItem?.pricing);
    if(!Number.isFinite(basePrice) || basePrice < 0) return 0;

    const variantAmount = (shopItem.variantGroups || []).reduce((total,group)=>{
        if(!group.active) return total;

        const activeAmounts = (group.options || [])
            .filter((option)=>option.active)
            .map((option)=>option.price !== null && option.price !== undefined ? Number(option.price) : Number(option.amount))
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

const formatShopItemPricing = ()=>({});

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

const getVariantOptionPackagingType = (option)=>String(option?.packagingType || "").toUpperCase();

const getVariantOptionInventoryQuantity = (option,selectedItem)=>{
    const packagingType = getVariantOptionPackagingType(option);
    if(packagingType === "LOOSE"){
        const rawQuantityValue = selectedItem.quantityValue ?? selectedItem.weight ?? selectedItem.measurementQuantity ?? selectedItem.quantity;
        const quantityValue = Number(rawQuantityValue);
        if(!Number.isFinite(quantityValue) || quantityValue <= 0){
            throw new apiError(400,`${option.label} quantityValue must be a positive number`);
        }

        const minOrderQuantity = Number(option.minOrderQuantity || option.quantityStep || option.quantityValue || 1);
        const maxOrderQuantity = option.maxOrderQuantity === null || option.maxOrderQuantity === undefined ? null : Number(option.maxOrderQuantity);
        const quantityStep = Number(option.quantityStep || minOrderQuantity || 1);
        const allowCustomQuantity = Boolean(option.allowCustomQuantity);
        if(quantityValue < minOrderQuantity){
            throw new apiError(400,`${option.label} minimum order quantity is ${minOrderQuantity}`);
        }
        if(maxOrderQuantity !== null && quantityValue > maxOrderQuantity){
            throw new apiError(400,`${option.label} maximum order quantity is ${maxOrderQuantity}`);
        }

        if(!allowCustomQuantity){
            const stepCount = Math.round((quantityValue - minOrderQuantity) / quantityStep);
            const expectedQuantity = minOrderQuantity + stepCount * quantityStep;
            if(Math.abs(expectedQuantity - quantityValue) > 0.000001){
                throw new apiError(400,`${option.label} quantityValue must follow step ${quantityStep}`);
            }
        }

        return Number(quantityValue.toFixed(3));
    }

    const quantity = Number(selectedItem.quantity ?? 1);
    if(!Number.isInteger(quantity) || quantity < 1){
        throw new apiError(400,`${option.label} quantity must be a positive integer`);
    }
    return quantity;
};

const resolveSelectedItemVariants = (shopItem,selectedOptionIds,selectedItem = {})=>{
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
            amount:option.amount,
            price:option.price ?? null,
            packagingType:option.packagingType || null,
            unit:option.unit || null,
            displayUnit:option.displayUnit || null,
            quantityValue:option.quantityValue ?? null,
            minOrderQuantity:option.minOrderQuantity ?? null,
            maxOrderQuantity:option.maxOrderQuantity ?? null,
            quantityStep:option.quantityStep ?? null,
            allowCustomQuantity:option.allowCustomQuantity ?? false,
            availableQuantity:option.availableQuantity ?? null,
            availableQuantityValue:option.availableQuantityValue ?? null,
            inventoryQuantity:option.packagingType ? getVariantOptionInventoryQuantity(option,selectedItem) : null,
            inventoryType:getVariantOptionPackagingType(option) === "LOOSE" ? "VALUE" : option.packagingType ? "COUNT" : null
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
    getVariantOptionInventoryQuantity,
    getVariantOptionPackagingType,
    getShopItemPricingMode,
    hasShopItemVariants,
    normalizeShopItemPricingInput,
    parseVariantOptionIds,
    resolveSelectedItemVariants,
    shopItemPricingSelect,
    shopItemVariantSelect
};
