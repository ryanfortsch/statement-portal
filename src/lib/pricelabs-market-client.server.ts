import 'server-only';

const endpoint='https://mcp.pricelabs.co/mcp';
const readTools=new Set(['get_listings','get_neighbourhood_data','get_neighborhood_data_sources']);
type RpcResult={jsonrpc?:string;id?:number;result?:unknown;error?:unknown};
function parseMessage(text:string):RpcResult {try{return JSON.parse(text) as RpcResult;}catch{throw Error('PriceLabs returned invalid JSON');}}
/** The token must have only `read` scope. No pricing, customization or generic tool executor is exposed. */
export async function createPriceLabsMarketClient(token:{access_token:string;scope:string},fetcher:typeof fetch=fetch){
  if(!token.access_token||token.scope.trim()!=='read')throw Error('A read-only PriceLabs token is required');
  let session:string|null=null,protocol='2025-06-18',nextId=0;
  async function rpc(method:string,params:unknown,notification=false):Promise<unknown>{
    const id=++nextId;
    const response=await fetcher(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':protocol,...(session?{'Mcp-Session-Id':session}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,params})});
    if(!response.ok)throw Error(`PriceLabs read failed (${response.status})`);
    session=response.headers.get('mcp-session-id')??session;
    if(notification){await response.body?.cancel();return;}
    if(!response.body)throw Error('PriceLabs returned an empty response');
    const stream=response.headers.get('content-type')?.includes('text/event-stream');
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',size=0,result:RpcResult|undefined;
    try {
      while(!result){
        const part=await reader.read();if(part.done)break;
        size+=part.value.byteLength;if(size>15000000)throw Error('PriceLabs response exceeds the read limit');
        pending+=decoder.decode(part.value,{stream:true});
        if(stream){
          const events=pending.split(/\r?\n\r?\n/);pending=events.pop()??'';
          for(const event of events){const text=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!text)continue;
            const message=parseMessage(text);if(message.id===id){result=message;break;}}
        }
      }
      if(!stream)result=parseMessage(pending);
    }finally{await reader.cancel();}
    if(!result||result.id!==id||result.error||!('result' in result))throw Error('PriceLabs returned an invalid or failed read');
    return result.result;
  }
  const initialized=await rpc('initialize',{protocolVersion:protocol,capabilities:{},clientInfo:{name:'Helm Market Data',version:'1.0.0'}}) as {protocolVersion?:string};
  if(!['2024-11-05','2025-03-26','2025-06-18'].includes(initialized.protocolVersion??''))throw Error('Unsupported PriceLabs protocol');
  protocol=initialized.protocolVersion!;await rpc('notifications/initialized',{},true);
  async function read(name:string,args:Record<string,unknown>):Promise<unknown>{
    if(!readTools.has(name))throw Error('PriceLabs write tools are not supported');
    const result=await rpc('tools/call',{name,arguments:args}) as {isError?:boolean;structuredContent?:unknown;content?:{type:string;text?:string}[]};
    if(result.isError)throw Error('PriceLabs could not read this listing');
    if(result.structuredContent)return result.structuredContent;
    try{return JSON.parse((result.content??[]).filter(c=>c.type==='text').map(c=>c.text??'').join('\n'));}
    catch{throw Error('PriceLabs returned unsupported market data');}
  }
  return {
    listings:()=>read('get_listings',{}),
    market:(listingId:string,pms:string)=>read('get_neighbourhood_data',{listing_id:listingId,pms_name:pms,mode:'detail',include_prices:true,include_future_prices:true,include_occupancy:true}),
  };
}
