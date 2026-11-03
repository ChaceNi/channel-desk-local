export type Platform='all'|'shopify'|'amazon'|'walmart'|'target'|'other'|'unassigned';
export type Metrics={total_sales:number;net_sales:number;orders:number;gross_sales:number;discounts:number;sales_reversals:number};
export type StoreScope='lakeside'|'ltd'|'all';
export type StoreOption={id:Exclude<StoreScope,'all'>;shopId:string;label:string;shopName:string};
export const stores:StoreOption[]=[{id:'lakeside',shopId:'65380483281',label:'Lakeside Collection',shopName:'The Lakeside Collection'},{id:'ltd',shopId:'66814050502',label:'LTD Commodities',shopName:'LTD Commodities'}];
export const storeIds=(scope:StoreScope)=>scope==='all'?stores.map(s=>s.shopId):[stores.find(s=>s.id===scope)!.shopId];
export type Row=Metrics&{day:string;sales_channel:string;shop_id:string;shop_name:string;order_id?:string;platform:Exclude<Platform,'all'>};
export type OrderMeta={id:string;tags:string[];customAttributes:{key:string;value:string|null}[]};
export type EngagementRow={day:string;sessions:number;completed:number;shop_id:string;shop_name:string;referring_channel:string};
export type RevenueSourceRow={day:string;total_sales:number;shop_id:string;shop_name:string;marketing_channel:string;traffic_type:string};
export type ProductRow={title:string;units:number;sales:number};
export type ProductSearchRow=ProductRow&{sku:string};
export type ProductTrendRow={day:string;units:number;sales:number};
export type ProductOrderRow={day:string;orderId:string;units:number;sales:number;shopId:string;shopName:string};
export const platforms:{id:Platform;name:string;mark:string;color:string}[]=[{id:'all',name:'全部平台',mark:'◈',color:'#1d4035'},{id:'shopify',name:'Shopify',mark:'S',color:'#648c3d'},{id:'amazon',name:'Amazon',mark:'a',color:'#b97c31'},{id:'walmart',name:'Walmart',mark:'W',color:'#4684b2'},{id:'target',name:'Target',mark:'◎',color:'#c25e5a'},{id:'other',name:'其他渠道',mark:'+',color:'#8c83aa'},{id:'unassigned',name:'待识别',mark:'?',color:'#92958e'}];
export const blank=():Metrics=>({total_sales:0,net_sales:0,orders:0,gross_sales:0,discounts:0,sales_reversals:0});
export const keys=(Object.keys(blank()) as (keyof Metrics)[]);
export function add(rows:Metrics[]):Metrics {return rows.reduce((a,r)=>{for(const k of keys)a[k]+=r[k]||0;return a},blank())}
export function directPlatform(channel:string):Exclude<Platform,'all'> {
  if(/amazon/i.test(channel))return 'amazon';if(/walmart|warmart/i.test(channel))return 'walmart';if(/target/i.test(channel))return 'target';
  if(/^(online store|shopify|shop)$/i.test(channel))return 'shopify';
  if(/connector|marketplace|bridge/i.test(channel))return 'unassigned';return 'other';
}
export function classify(meta:OrderMeta|undefined):Exclude<Platform,'all'> {
 if(!meta)return 'unassigned';
 const match=(s:string):Exclude<Platform,'all'>|undefined=>/amazon/i.test(s)?'amazon':/walmart|warmart/i.test(s)?'walmart':/target/i.test(s)?'target':undefined;
 const attrs=meta.customAttributes.filter(a=>/^(order channel|marketplace|sales channel|platform|channel)$/i.test(a.key));
 const evidence=new Set(attrs.map(a=>match(a.value||'')).filter(Boolean));
 if(evidence.size===1)return [...evidence][0]!;if(evidence.size>1)return 'unassigned';
 const tags=new Set(meta.tags.map(t=>/^(amazon|walmart|warmart|target)(\b|[ _-])/i.test(t)?match(t):undefined).filter(Boolean));
 return tags.size===1?[...tags][0]!:'unassigned';
}
export function tableRows(result:unknown):{rows:Row[];shop:{name:string;currencyCode:string;ianaTimezone:string}} {
 const outer=result as {data?:{shop?:{name:string;currencyCode:string;ianaTimezone:string};shopifyqlQuery?:{parseErrors?:string[];tableData?:{columns:{name:string}[];rows:unknown[]}}};errors?:{message:string}[]};
 if(outer.errors?.length)throw new Error(outer.errors.map(e=>e.message).join('；'));
 const report=outer.data?.shopifyqlQuery;
 if(report?.parseErrors?.length)throw new Error(report.parseErrors.join('；'));
 if(!report?.tableData||!outer.data?.shop)throw new Error('Shopify 未返回有效报表。');
 const cols=report.tableData.columns.map(c=>c.name);
 const rows=report.tableData.rows.map(raw=>{
   const obj=(Array.isArray(raw)?Object.fromEntries(cols.map((c,i)=>[c,raw[i]])):raw) as Record<string,unknown>;
   if(!obj.day||!obj.sales_channel)throw new Error('报表缺少日期或渠道。');
   const values=Object.fromEntries(keys.map(k=>{const n=Number(obj[k]??0);if(!Number.isFinite(n))throw new Error('报表包含无效数值。');return[k,n]})) as Metrics;
   return {...values,day:String(obj.day).slice(0,10),sales_channel:String(obj.sales_channel),shop_id:String(obj.shop_id||''),shop_name:String(obj.shop_name||''),order_id:obj.order_id?String(obj.order_id):undefined,platform:directPlatform(String(obj.sales_channel))};
 });
 if(rows.length>=20000)throw new Error('报表达到读取上限，请缩短日期范围后重试。');
 return {rows,shop:outer.data.shop};
}
function analyticsRows(result:unknown):Record<string,unknown>[] {
 const outer=result as {data?:{shopifyqlQuery?:{parseErrors?:string[];tableData?:{columns:{name:string}[];rows:unknown[]}}};errors?:{message:string}[]};
 if(outer.errors?.length)throw new Error(outer.errors.map(e=>e.message).join('；'));
 const report=outer.data?.shopifyqlQuery;
 if(report?.parseErrors?.length)throw new Error(report.parseErrors.join('；'));
 if(!report?.tableData)throw new Error('Shopify 未返回有效分析报表。');
 const cols=report.tableData.columns.map(c=>c.name);
 return report.tableData.rows.map(raw=>(Array.isArray(raw)?Object.fromEntries(cols.map((c,i)=>[c,raw[i]])):raw) as Record<string,unknown>);
}
export function engagementRows(result:unknown):EngagementRow[] {
 return analyticsRows(result).map(row=>{
  const sessions=Number(row.sessions??0),completed=Number(row.sessions_that_completed_checkout??0);
  if(!row.day||!Number.isFinite(sessions)||!Number.isFinite(completed))throw new Error('Shopify 会话报表包含无效字段。');
  return {day:String(row.day).slice(0,10),sessions,completed,shop_id:String(row.shop_id||''),shop_name:String(row.shop_name||''),referring_channel:String(row.referring_channel||'unattributed')};
 });
}
export function revenueSourceRows(result:unknown):RevenueSourceRow[] {
 return analyticsRows(result).map(row=>{
  const total_sales=Number(row.total_sales__last_non_direct_click??row.total_sales??0);
  if(!row.day||!Number.isFinite(total_sales))throw new Error('Shopify Growth 渠道营收报表包含无效字段。');
  return {day:String(row.day).slice(0,10),total_sales,shop_id:String(row.shop_id||''),shop_name:String(row.shop_name||''),marketing_channel:String(row.marketing_channel||''),traffic_type:String(row.traffic_type||'')};
 });
}
export function productRows(result:unknown):ProductRow[] {
 const combined=new Map<string,ProductRow>();
 for(const row of analyticsRows(result)){
  const units=Number(row.net_items_sold??0),sales=Number(row.net_sales??0);
  if(!Number.isFinite(units)||!Number.isFinite(sales))throw new Error('Shopify 商品报表包含无效数值。');
  const title=String(row.product_title||'未命名商品'),previous=combined.get(title);
  if(previous){previous.units+=units;previous.sales+=sales}else combined.set(title,{title,units,sales});
 }
 return [...combined.values()];
}
export function productSearchRows(result:unknown):ProductSearchRow[] {
 return analyticsRows(result).map(row=>{
  const units=Number(row.net_items_sold??0),sales=Number(row.net_sales??0);
  if(!row.product_title||!Number.isFinite(units)||!Number.isFinite(sales))throw new Error('产品搜索结果包含无效字段。');
  return {title:String(row.product_title),sku:String(row.product_variant_sku_at_time_of_sale??row.product_variant_sku??''),units,sales};
 });
}
export function productTrendRows(result:unknown):ProductTrendRow[] {
 return analyticsRows(result).map(row=>{
  const units=Number(row.net_items_sold??0),sales=Number(row.net_sales??0);
  if(!row.day||!Number.isFinite(units)||!Number.isFinite(sales))throw new Error('单品销量趋势包含无效字段。');
  return {day:String(row.day).slice(0,10),units,sales};
 });
}
export function productOrderRows(result:unknown):ProductOrderRow[] {
 const grouped=new Map<string,ProductOrderRow>();
 for(const row of analyticsRows(result)){
  const day=String(row.day||'').slice(0,10),orderId=String(row.order_id||'');
  const units=Number(row.net_items_sold??0),sales=Number(row.net_sales??0),shopId=String(row.shop_id||''),shopName=String(row.shop_name||'');
  // Shopify can return aggregate/adjustment rows without an order identifier.
  // Ignore those rows instead of invalidating every usable order in the report.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!orderId||!Number.isFinite(units)||!Number.isFinite(sales))continue;
  const key=`${shopId}|${orderId}|${day}`,current=grouped.get(key);
  if(current){current.units+=units;current.sales+=sales}else grouped.set(key,{day,orderId,units,sales,shopId,shopName});
 }
 return [...grouped.values()].sort((a,b)=>b.day.localeCompare(a.day)||b.orderId.localeCompare(a.orderId));
}
export function unwrap(result:unknown):unknown {
 const r=result as {structuredContent?:unknown;content?:{type:string;text?:string}[]};
 if(r.structuredContent!==undefined&&r.structuredContent!==null)return r.structuredContent;
 for(const c of r.content||[])if(c.type==='text'&&c.text)try{const parsed=JSON.parse(c.text);if(parsed&&typeof parsed==='object')return parsed}catch{}
 throw new Error('Shopify 响应格式无法识别。');
}
export function reconcile(daily:Row[],detail:Row[],metadata:Map<string,OrderMeta>):{rows:Row[];mismatch:boolean} {
 const buckets=new Map<string,Row[]>();for(const r of detail){const k=r.shop_id+'|'+r.day+'|'+r.sales_channel;buckets.set(k,[...(buckets.get(k)||[]),r])}
 let mismatch=false;
 const rows=daily.flatMap(r=>{
   if(r.platform!=='unassigned'||r.shop_id!==stores[0].shopId)return[r];const sub=buckets.get(r.shop_id+'|'+r.day+'|'+r.sales_channel)||[];
   // Reconcile every additive measure before replacing a connector aggregate.
   const sum=add(sub);if(!sub.length||keys.some(k=>Math.abs(sum[k]-r[k])>0.025)){mismatch=true;return[r]}
   return sub.map(s=>({...s,platform:classify(metadata.get('gid://shopify/Order/'+s.order_id))}));
 });return{rows,mismatch};
}
export function shiftDay(day:string,delta:number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)}
export function dates(start:string,end:string){const out:string[]=[];for(let d=start;d<=end;d=shiftDay(d,1))out.push(d);return out}

export function reportWarnings(value:unknown):string[]{
 const warnings=(value as {dashboardWarnings?:unknown}|null)?.dashboardWarnings;
 return Array.isArray(warnings)?warnings.filter((item):item is string=>typeof item==='string'):[];
}
