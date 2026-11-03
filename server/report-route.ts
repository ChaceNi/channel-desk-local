const connectorResponse=(result:unknown)=>Response.json(result);
import { ANALYTICS_QUERY, ATTRIBUTION_QUERY, ENGAGEMENT_QUERY, METRICS, PRODUCTS_QUERY } from '../lib/queries.js';
import { invokeReports } from './shopify.mjs';
const STORE_IDS = ['65380483281','66814050502'] as const;
const LAKESIDE_ID = STORE_IDS[0];
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: {'Cache-Control':'private, no-store'} });
export async function POST(request:Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return reply({status:'invalid_request',message:'请求来源无效。'},403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const kinds=['attribution','daily','detail','engagement','revenueSources','products','productSearch','productTrend','productOrders'];
    if(!kinds.includes(String(body.kind)))return reply({status:'invalid_request',message:'不支持的查询。'},400);
    const invoke=invokeReports;
    let query:string; let variables:Record<string, string|string[]>;
    // Attribution IDs come from Lakeside's connector orders. Analytics branches
    // replace this with the validated store selection before invoking Shopify.
    let storeIds: string[] = [LAKESIDE_ID];
    if (body.kind === 'attribution') {
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length>250 || body.ids.some(id=>typeof id!=='string'||!/^gid:\/\/shopify\/Order\/\d+$/.test(id))) return reply({status:'invalid_request',message:'订单列表无效。'},400);
      query = ATTRIBUTION_QUERY; variables = {ids:body.ids as string[]};
    } else if (body.kind === 'daily' || body.kind === 'detail' || body.kind === 'engagement' || body.kind === 'revenueSources' || body.kind === 'products' || body.kind === 'productSearch' || body.kind === 'productTrend' || body.kind === 'productOrders') {
      const {start,end} = body;
      const validDate=(d:unknown):d is string=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
      if(!validDate(start)||!validDate(end)) return reply({status:'invalid_request',message:'请选择有效日期。'},400);
      const days=(Date.parse(end)-Date.parse(start))/86400000+1;
      if(days<1||days>62) return reply({status:'invalid_request',message:'单次查询最多支持 62 天。'},400);
      const rawStoreIds=body.storeIds===undefined?STORE_IDS:body.storeIds;
      if(!Array.isArray(rawStoreIds)||rawStoreIds.length<1||rawStoreIds.length>2||new Set(rawStoreIds).size!==rawStoreIds.length||rawStoreIds.some(id=>typeof id!=='string'||!STORE_IDS.includes(id as typeof STORE_IDS[number]))) return reply({status:'invalid_request',message:'店铺选择无效。'},400);
      storeIds=rawStoreIds as string[];
      const storeFilter=`shop_id IN (${storeIds.join(', ')})`;
      if(body.kind==='engagement') {
        query=ENGAGEMENT_QUERY;
        variables={query:`FROM ORGANIZATION sessions SHOW sessions, sessions_that_completed_checkout, shop_id, shop_name, referring_channel WHERE ${storeFilter} GROUP BY shop_id, shop_name, referring_channel TIMESERIES day SINCE ${start} UNTIL ${end} ORDER BY day ASC LIMIT 20000`};
        const result=await invoke(storeIds,query,variables);
        const response=await connectorResponse(result).json() as Record<string,unknown>;
        if(result.status==='reauthentication_required') response.chatGPTSignInPath='/setup';
        return reply(response);
      }
      if(body.kind==='revenueSources') {
        query=ENGAGEMENT_QUERY;
        variables={query:`FROM ORGANIZATION sales SHOW total_sales, marketing_channel, traffic_type, shop_id, shop_name WHERE ${storeFilter} GROUP BY shop_id, shop_name, marketing_channel, traffic_type WITH LAST_NON_DIRECT_CLICK_ATTRIBUTION TIMESERIES day SINCE ${start} UNTIL ${end} ORDER BY day ASC LIMIT 20000`};
        const result=await invoke(storeIds,query,variables);
        const response=await connectorResponse(result).json() as Record<string,unknown>;
        if(result.status==='reauthentication_required') response.chatGPTSignInPath='/setup';
        return reply(response);
      }
      if(body.kind==='products') {
        query=PRODUCTS_QUERY;
        const onDay=body.onDay;
        if(onDay!==undefined&&!validDate(onDay)) return reply({status:'invalid_request',message:'Top 3 日期无效。'},400);
        const productRange=`FROM ORGANIZATION sales SHOW net_items_sold, net_sales, product_title WHERE ${storeFilter} GROUP BY product_title SINCE ${start} UNTIL ${end} ORDER BY product_title ASC LIMIT 20000`;
        const shopifyql=onDay?`FROM ORGANIZATION sales SHOW net_items_sold, net_sales, product_title WHERE ${storeFilter} GROUP BY product_title SINCE ${onDay} UNTIL ${onDay} ORDER BY product_title ASC LIMIT 20000`:productRange;
        variables={query:shopifyql};
        const result=await invoke(storeIds,query,variables);
        const response=await connectorResponse(result).json() as Record<string,unknown>;
        if(result.status==='reauthentication_required') response.chatGPTSignInPath='/setup';
        return reply(response);
      }
      if(body.kind==='productSearch'||body.kind==='productTrend'||body.kind==='productOrders') {
        const name=body.kind==='productSearch'?body.search:body.productTitle;
        if(typeof name!=='string'||name.trim().length<(body.kind==='productSearch'?2:1)||name.trim().length>255) return reply({status:'invalid_request',message:'请输入至少 2 个字符的 SKU 或产品关键词。'},400);
        const escaped=name.trim().replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const rawSku=body.productSku;
        if(rawSku!==undefined&&(typeof rawSku!=='string'||!rawSku.trim()||rawSku.trim().length>255)) return reply({status:'invalid_request',message:'SKU 无效。'},400);
        const escapedSku=typeof rawSku==='string'?rawSku.trim().replace(/\\/g,'\\\\').replace(/'/g,"\\'"):'';
        const productFilter=body.kind==='productSearch'?`(product_title CONTAINS '${escaped}' OR product_variant_sku_at_time_of_sale CONTAINS '${escaped}')`:escapedSku?`product_variant_sku_at_time_of_sale = '${escapedSku}'`:`product_title = '${escaped}'`;
        const dimensions='product_title, product_variant_sku_at_time_of_sale, shop_id, shop_name';
        const report=body.kind==='productSearch'
          ?`FROM ORGANIZATION sales SHOW net_items_sold, net_sales, product_title, product_variant_sku_at_time_of_sale WHERE ${storeFilter} AND ${productFilter} GROUP BY ${dimensions} SINCE ${start} UNTIL ${end} ORDER BY net_sales DESC LIMIT 500`
          :body.kind==='productTrend'
            ?`FROM ORGANIZATION sales SHOW net_items_sold, net_sales, product_title, product_variant_sku_at_time_of_sale WHERE ${storeFilter} AND ${productFilter} GROUP BY ${dimensions} TIMESERIES day SINCE ${start} UNTIL ${end} ORDER BY day ASC LIMIT 20000`
            :`FROM ORGANIZATION sales SHOW order_id, net_items_sold, net_sales, product_title, product_variant_sku_at_time_of_sale, shop_id, shop_name WHERE ${storeFilter} AND ${productFilter} GROUP BY order_id, product_title, product_variant_sku_at_time_of_sale, shop_id, shop_name TIMESERIES day SINCE ${start} UNTIL ${end} ORDER BY day DESC LIMIT 20000`;
        query=PRODUCTS_QUERY;variables={query:report};
        const result=await invoke(storeIds,query,variables);
        const response=await connectorResponse(result).json() as Record<string,unknown>;
        if(result.status==='reauthentication_required') response.chatGPTSignInPath='/setup';
        return reply(response);
      }
      let filter=` WHERE ${storeFilter}`; let group='shop_id, shop_name, sales_channel';
      if(body.kind==='detail') {
        if(storeIds.length!==1||storeIds[0]!==LAKESIDE_ID) return reply({status:'invalid_request',message:'仅支持读取 Lakeside Collection 的平台订单属性。'},400);
        if(!Array.isArray(body.channels)||body.channels.length<1||body.channels.length>20||body.channels.some(c=>typeof c!=='string'||c.length>150)) return reply({status:'invalid_request',message:'渠道列表无效。'},400);
        const escaped=(body.channels as string[]).map(c=>`'${c.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}'`);
        filter=` WHERE shop_id = ${LAKESIDE_ID} AND sales_channel IN (${escaped.join(', ')})`; group='shop_id, shop_name, sales_channel, order_id';
      }
      query=ANALYTICS_QUERY;variables={query:`FROM ORGANIZATION sales SHOW ${METRICS}, shop_id, shop_name${filter} GROUP BY ${group} TIMESERIES day SINCE ${start} UNTIL ${end} LIMIT 20000`};
    } else return reply({status:'invalid_request',message:'不支持的查询。'},400);
    const result=await invoke(storeIds,query,variables);
    const response=await connectorResponse(result).json() as Record<string,unknown>;
    if(result.status==='reauthentication_required') response.chatGPTSignInPath='/setup';
    return reply(response);
  } catch (error) {return reply({status:'tool_error',message:error instanceof Error?error.message:'暂时无法读取 Shopify。'},502);}
}
