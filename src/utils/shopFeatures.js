import { apiError } from "./handler.js";

const allowedShopFeatures = ["ITEMS","CATEGORIES","CUISINE","MENUS","COMBOS","VARIANTS"];

const normalizeShopFeature = (feature)=>{
    const normalizedFeature = String(feature || "").trim().toUpperCase();
    if(!allowedShopFeatures.includes(normalizedFeature)){
        throw new apiError(400,`invalid feature: ${feature}`);
    }
    return normalizedFeature;
};

const normalizeShopFeatures = (features,{allowEmpty = false} = {})=>{
    if(!Array.isArray(features)){
        throw new apiError(400,"features must be an array");
    }

    const normalizedFeatures = [...new Set(features.map(normalizeShopFeature))];
    if(!allowEmpty && normalizedFeatures.length === 0){
        throw new apiError(400,"features must be a non-empty array");
    }
    return normalizedFeatures;
};

const shopFeatureSelect = {
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
};

const getBaseShopFeatures = (shop)=>shop?.shopType?.features?.map((feature)=>feature.feature) || [];

const getShopFeatureOverrides = (shop)=>shop?.featureOverrides?.map((override)=>({
    feature:override.feature,
    enabled:override.enabled
})) || [];

const getEffectiveShopFeatures = (shop)=>{
    const baseFeatures = new Set(getBaseShopFeatures(shop));

    for(const override of getShopFeatureOverrides(shop)){
        if(override.enabled){
            baseFeatures.add(override.feature);
        }else{
            baseFeatures.delete(override.feature);
        }
    }

    return [...baseFeatures];
};

const formatShopFeatureMap = (shop)=>getEffectiveShopFeatures(shop).reduce((features,feature)=>{
        features[feature.toLowerCase()] = true;
        return features;
    },allowedShopFeatures.reduce((features,feature)=>{
        features[feature.toLowerCase()] = false;
        return features;
    },{}));

const shopHasFeature = (shop,feature)=>{
    if(!shop?.shopType && !shop?.featureOverrides?.length) return true;
    return getEffectiveShopFeatures(shop).includes(normalizeShopFeature(feature));
};

const formatShopFeatureSummary = (shop)=>({
    shop:{
        id:shop.id,
        shopName:shop.shopName,
        shopType:shop.shopType ? {
            id:shop.shopType.id,
            name:shop.shopType.name,
            slug:shop.shopType.slug
        } : null
    },
    baseFeatures:getBaseShopFeatures(shop),
    overrides:getShopFeatureOverrides(shop),
    effectiveFeatures:getEffectiveShopFeatures(shop),
    features:formatShopFeatureMap(shop)
});

export {
    allowedShopFeatures,
    formatShopFeatureMap,
    formatShopFeatureSummary,
    getEffectiveShopFeatures,
    normalizeShopFeature,
    normalizeShopFeatures,
    shopFeatureSelect,
    shopHasFeature
};
