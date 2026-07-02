import "dotenv/config";
import fs from "fs";
import pg from "pg";

const collection = JSON.parse(fs.readFileSync("postman/eLabAssist.postman_collection.json", "utf8"));
const baseUrl = process.env.POSTMAN_BASE_URL || "http://localhost:8000";

const tokens = {
  admin: process.env.POSTMAN_ADMIN_TOKEN,
  seller: process.env.POSTMAN_SELLER_TOKEN,
  buyer: process.env.POSTMAN_BUYER_TOKEN,
};

for (const [role, token] of Object.entries(tokens)) {
  if (!token) {
    console.error(`POSTMAN_${role.toUpperCase()}_TOKEN is required`);
    process.exit(1);
  }
}

const decode = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
const tokenUsers = Object.fromEntries(Object.entries(tokens).map(([role, token]) => {
  const payload = decode(token);
  return [role, { id: payload.id, name: payload.name, exp: new Date(payload.exp * 1000).toISOString() }];
}));

const vars = Object.fromEntries((collection.variable || []).map((variable) => [variable.key, variable.value || ""]));
vars.baseUrl = baseUrl;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const first = async (query) => {
  const result = await pool.query(query);
  return result.rows[0] || {};
};

try {
  const [
    adminUser,
    sellerUser,
    buyerUser,
    sellerShop,
    anyShop,
    cuisine,
    category,
    item,
    shopItem,
    combo,
    menu,
    order,
    brand,
    tag,
    offer,
    banner,
    shopType,
    dayOption,
    amountOption,
    recharge,
    variantGroup,
    variantOption,
    ad,
    buyerAd,
  ] = await Promise.all([
    first(`select id from "User" where role = 'ADMIN' and "isBlocked" = false limit 1`),
    first(`select id from "User" where id = '${tokenUsers.seller.id}' limit 1`),
    first(`select id from "User" where id = '${tokenUsers.buyer.id}' limit 1`),
    first(`select id, slug from "Shop" where "ownerId" = '${tokenUsers.seller.id}' order by "createdAt" desc limit 1`),
    first(`select id, slug from "Shop" order by "createdAt" desc limit 1`),
    first(`select id, name from "Cuisine" order by "sortOrderId" asc nulls last limit 1`),
    first(`select id, name from "Categories" order by "sortOrderId" asc nulls last limit 1`),
    first(`select id, name from "Items" order by "createdAt" desc limit 1`),
    first(`select id from "ShopItem" order by "createdAt" desc limit 1`),
    first(`select id from "Combo" order by "createdAt" desc limit 1`),
    first(`select id from "Menu" order by "createdAt" desc limit 1`),
    first(`select id from "Order" order by "createdAt" desc limit 1`),
    first(`select id from "Brand" order by "createdAt" desc limit 1`),
    first(`select id from "Tag" order by "createdAt" desc limit 1`),
    first(`select id from "Offer" order by "createdAt" desc limit 1`),
    first(`select id from "Banner" order by "createdAt" desc limit 1`),
    first(`select id, slug from "ShopType" order by "createdAt" desc limit 1`),
    first(`select id from "RechargeDayOption" order by days asc limit 1`),
    first(`select id from "RechargeAmountOption" order by amount asc limit 1`),
    first(`select id from "Recharges" order by "createdAt" desc limit 1`),
    first(`select id from "ShopItemVariantGroup" order by "createdAt" desc limit 1`),
    first(`select id from "ShopItemVariantOption" order by "createdAt" desc limit 1`),
    first(`select id from "Ad" order by "createdAt" desc limit 1`),
    first(`select id from "BuyerAds" order by "createdAt" desc limit 1`),
  ]);

  const shop = sellerShop.id ? sellerShop : anyShop;
  Object.assign(vars, {
    accessToken: tokens.buyer,
    adminToken: tokens.admin,
    sellerToken: tokens.seller,
    buyerId: buyerUser.id || tokenUsers.buyer.id,
    sellerId: sellerUser.id || tokenUsers.seller.id,
    userId: buyerUser.id || tokenUsers.buyer.id,
    adminShopId: shop.id || vars.adminShopId,
    shopId: shop.id || vars.shopId,
    shopSlug: shop.slug || vars.shopSlug,
    cuisineId: cuisine.id || vars.cuisineId,
    cuisineName: cuisine.name || vars.cuisineName,
    categoryId: category.id || vars.categoryId,
    categoryName: category.name || vars.categoryName,
    itemId: item.id || vars.itemId,
    itemName: item.name || vars.itemName,
    shopItemId: shopItem.id || vars.shopItemId,
    comboId: combo.id || vars.comboId,
    menuId: menu.id || vars.menuId,
    orderId: order.id || vars.orderId,
    brandId: brand.id || vars.brandId,
    tagId: tag.id || vars.tagId,
    offerId: offer.id || vars.offerId,
    bannerId: banner.id || vars.bannerId,
    shopTypeId: shopType.id || vars.shopTypeId,
    shopTypeSlug: shopType.slug || vars.shopTypeSlug,
    dayOptionId: dayOption.id || vars.dayOptionId,
    amountOptionId: amountOption.id || vars.amountOptionId,
    rechargeId: recharge.id || vars.rechargeId,
    variantGroupId: variantGroup.id || vars.variantGroupId,
    variantOptionId: variantOption.id || vars.variantOptionId,
    adId: ad.id || vars.adId,
    buyerAdId: buyerAd.id || vars.buyerAdId,
  });
} finally {
  await pool.end();
}

const substitute = (value) => String(value).replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key] ?? "");
const chooseToken = (name) => {
  if (name.includes("[Public]")) return null;
  if (name.includes("[Buyer]")) return tokens.buyer;
  if (name.includes("[Seller]")) return tokens.seller;
  if (name.includes("[Admin]")) return tokens.admin;
  if (name.includes("[Admin/Seller]") || name.includes("[Seller/Admin]")) return tokens.seller;
  if (name.includes("[Admin/Buyer]")) return tokens.buyer;
  if (name.includes("[Admin/Self]")) return tokens.admin;
  return tokens.buyer;
};

const requests = [];
const skipped = [];
const walk = (items, path = []) => {
  for (const item of items || []) {
    const nextPath = [...path, item.name];
    if (item.item) {
      walk(item.item, nextPath);
      continue;
    }
    const method = item.request?.method;
    if (method === "GET") requests.push({ name: nextPath.join(" > "), request: item.request });
    else skipped.push({ name: nextPath.join(" > "), method });
  }
};
walk(collection.item);

const results = [];
for (const entry of requests) {
  const url = substitute(entry.request.url.raw);
  const token = chooseToken(entry.name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const headers = token ? { Authorization: `Bearer ${token}`, accessToken: token } : {};
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: "manual" });
    const text = await response.text();
    let message = "";
    try {
      const json = JSON.parse(text);
      message = json.message || json.Msg || "";
    } catch {
      message = text.slice(0, 120).replace(/\s+/g, " ");
    }
    results.push({ name: entry.name, status: response.status, ok: response.ok || response.status === 302, message });
  } catch (error) {
    results.push({ name: entry.name, status: "ERR", ok: false, message: error.message });
  } finally {
    clearTimeout(timer);
  }
}

const summary = results.reduce((acc, result) => {
  const key = String(result.status);
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  baseUrl,
  tokenUsers,
  totalGetRequests: results.length,
  skippedMutatingRequests: skipped.length,
  summary,
  failures: results.filter((result) => !result.ok),
}, null, 2));
