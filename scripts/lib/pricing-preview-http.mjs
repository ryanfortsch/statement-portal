/** Local read-only preview boundary. No API credentials or customer data are embedded in the bundle. */
export async function pricingPreviewRequest(req,res,{port,token,portfolio,calendar,asset}) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const origin=`http://127.0.0.1:${port}`;
  if(req.headers.host!==`127.0.0.1:${port}`||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==origin)) {res.writeHead(403).end('Local preview only');return;}
  if(req.method!=='GET') {res.writeHead(405,{Allow:'GET'}).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/open'&&url.searchParams.get('key')===token) {
    res.setHeader('Set-Cookie',`helm_pricing_preview=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    res.writeHead(303,{Location:'/'}).end();return;
  }
  if(!(req.headers.cookie??'').split(';').some(v=>v.trim()===`helm_pricing_preview=${token}`)) {res.writeHead(401).end('Open the private preview link to continue.');return;}
  try {
    if(url.pathname==='/portfolio'||url.pathname==='/calendar') {
      const value=url.pathname==='/portfolio'?await portfolio():await calendar(url.searchParams.get('property')??'');
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,value}));return;
    }
    const file=await asset(url.pathname);
    if(!file){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',file.type);res.end(file.body);
  } catch {
    res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,error:'Calendar data is unavailable. Try refreshing.'}));
  }
}
