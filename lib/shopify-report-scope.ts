import type { ConnectorResult, Json } from './connector-contract.mjs';

export const CONNECTED_SHOP_QUERY = `query DashboardConnectedShop { shop { id name currencyCode ianaTimezone } }`;
const SHOP_NAMES: Record<string,string> = {'65380483281':'Lakeside Collection','66814050502':'LTD Commodities'};

// Only rewrite SQL outside quoted user product names. Store selection is enforced
// by the actual authenticated shop, never by a client-supplied name or label.
export function singleShopQuery(query:string):string {
 return query.split(/('(?:\\.|[^'\\])*')/g).map((part,index)=>index%2?part:part
  .replace(/\bFROM\s+ORGANIZATION\s+/gi,'FROM ')
  .replace(/\bWHERE\s+shop_id\s+(?:IN\s*\([\d,\s]+\)|=\s*\d+)\s+AND\s+/gi,'WHERE ')
  .replace(/\bWHERE\s+shop_id\s+(?:IN\s*\([\d,\s]+\)|=\s*\d+)\s*(?=GROUP\s+BY|TIMESERIES|SINCE|ORDER\s+BY|LIMIT|$)/gi,'')
  .replace(/,\s*shop_id\s*,\s*shop_name\b/gi,'')
  .replace(/\bshop_id\s*,\s*shop_name\s*,\s*/gi,'')
 ).join('');
}
function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
export function connectorPayload(result:ConnectorResult):Record<string,unknown>{
 if(!result.result)return {};
 if(result.result.structuredContent!==undefined&&result.result.structuredContent!==null)return record(result.result.structuredContent);
 for(const item of result.result.content)if(item.type==='text'&&typeof item.text==='string')try{const obj=record(JSON.parse(item.text));if(Object.keys(obj).length)return obj}catch{}
 return {};
}
function messages(payload:Record<string,unknown>):string[]{
 const data=record(payload.data),report=record(data.shopifyqlQuery);
 return [...(Array.isArray(report.parseErrors)?report.parseErrors.map(String):[]),...(Array.isArray(payload.errors)?payload.errors.map(e=>String(record(e).message||'')):[])];
}
function organizationDenied(result:ConnectorResult):boolean {
 const text=[result.status==='success'?'':result.message,...messages(connectorPayload(result))].join(' ');
 return /organization[^.\n]*(?:permissions?|access)|permissions?[^.\n]*organization/i.test(text);
}
function wrapped(payload:Record<string,unknown>,source:ConnectorResult):ConnectorResult {
 if(source.status!=='success')return source;
 return {...source,result:{...source.result,structuredContent:payload as Json,content:[{type:'text',text:JSON.stringify(payload)}]}};
}
type Invoke=(query:string,variables:Record<string,string|string[]>)=>Promise<ConnectorResult>;

export async function invokeScopedConnector(invoke:Invoke,requestedIds:string[],query:string,variables:Record<string,string|string[]>):Promise<ConnectorResult>{
 const original=await invoke(query,variables);
 // No automatic replay for auth, transport, policy or non-organization errors.
 if(!organizationDenied(original)||typeof variables.query!=='string'||!/^FROM\s+ORGANIZATION\b/i.test(variables.query))return original;
 const scopeResult=await invoke(CONNECTED_SHOP_QUERY,{});
 if(scopeResult.status!=='success')return scopeResult;
 const scopePayload=connectorPayload(scopeResult),shop=record(record(scopePayload.data).shop);
 const id=typeof shop.id==='string'?shop.id.match(/^gid:\/\/shopify\/Shop\/(\d+)$/)?.[1]:undefined;
 if(!id||!SHOP_NAMES[id])return{status:'tool_error',message:'无法确认当前授权店铺，未读取单店报表。请检查 Shopify 连接。'};
 if(!requestedIds.includes(id))return{status:'tool_error',message:`当前 Shopify 连接仅可读取 ${SHOP_NAMES[id]}，没有所选店铺的报表权限。请切换到 ${SHOP_NAMES[id]}，或为所选店铺配置独立的只读授权。`};
 const fallback=await invoke(query,{...variables,query:singleShopQuery(variables.query)});
 if(fallback.status!=='success')return fallback;
 const payload=connectorPayload(fallback),errors=messages(payload);
 if(errors.length)return fallback;
 const data=record(payload.data),report=record(data.shopifyqlQuery),table=record(report.tableData);
 if(!Array.isArray(table.columns)||!Array.isArray(table.rows))return {status:'tool_error',message:'Shopify 未返回有效的单店报表。'};
 const columns=table.columns.map(record),names=columns.map(c=>String(c.name));
 const rows=table.rows.map(raw=>({...record(Array.isArray(raw)?Object.fromEntries(names.map((name,i)=>[name,raw[i]])):raw),shop_id:id,shop_name:String(shop.name||SHOP_NAMES[id])}));
 for(const name of ['shop_id','shop_name'])if(!names.includes(name))columns.push({name,dataType:'STRING'});
 const missing=requestedIds.filter(wanted=>wanted!==id);
 const warning=missing.length?`当前连接没有组织级报表权限；本次仅展示 ${SHOP_NAMES[id]} 的已授权数据，不包含 ${missing.map(wanted=>SHOP_NAMES[wanted]||wanted).join('、')}，不能作为全部店铺合计。`:'';
 return wrapped({...payload,data:{...data,shop,shopifyqlQuery:{...report,tableData:{...table,columns,rows}}},dashboardWarnings:warning?[warning]:[],dashboardScope:{requestedStoreIds:requestedIds,includedStoreIds:[id],missingStoreIds:missing}},fallback);
}
