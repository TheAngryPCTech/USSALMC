import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicFetch, isPublicAddress, resolvePublicTarget, UnsafeScrapeUrl } from '../src/public-fetch.js';
const publicDns = async () => [{address:'93.184.215.14',family:4}];
test('blocks local, reserved, metadata, mapped and transition addresses',async () => {
  for(const ip of ['0.0.0.0','10.1.2.3','100.100.100.200','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','198.18.0.1','224.0.0.1','255.255.255.255','::','::1','::ffff:127.0.0.1','fc00::1','fe80::1','64:ff9b::a00:1','2002:7f00:1::','2001:db8::1']) assert.equal(isPublicAddress(ip),false,ip);
  for(const url of ['http://2130706433/','http://0x7f000001/','http://127.1/','http://[::ffff:7f00:1]/','file:///etc/passwd','ftp://example.com','https://user:pass@example.com']) await assert.rejects(resolvePublicTarget(url,publicDns),UnsafeScrapeUrl);
  assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
});
test('rejects private and mixed DNS answers',async () => {
  for(const answers of [[],[{address:'10.0.0.1',family:4}],[...(await publicDns()),{address:'::1',family:6}]]) await assert.rejects(resolvePublicTarget('https://example.com',async()=>answers),UnsafeScrapeUrl);
});
test('revalidates redirects, and never transports private targets',async () => {
  for(const destination of ['http://127.0.0.1/','http://internal.test/','file:///etc/passwd']) {
    let calls=0;
    const fetch = createPublicFetch(async host=>host==='internal.test'?[{address:'10.0.0.1',family:4}]:publicDns(),async()=>{calls++;return new Response(null,{status:302,headers:{location:destination}})});
    await assert.rejects(fetch('https://public.test','test'),UnsafeScrapeUrl);assert.equal(calls,1);
  }
});
test('rechecks DNS on same-host redirects and rejects rebinding',async () => {
  let lookups=0,calls=0;
  const fetch=createPublicFetch(async()=>++lookups===1?publicDns():[{address:'127.0.0.1',family:4}],async()=>{calls++;return new Response(null,{status:302,headers:{location:'/next'}})});
  await assert.rejects(fetch('https://public.test','test'),UnsafeScrapeUrl);assert.equal(calls,1);
});
test('preserves hostname and supplies validated IP; follows public relative redirects',async()=>{
  const paths:string[]=[];
  const fetch=createPublicFetch(publicDns,async target=>{assert.equal(target.url.hostname,'public.test');assert.equal(target.address.address,'93.184.215.14');paths.push(target.url.pathname);return paths.length===1?new Response(null,{status:301,headers:{location:'/page'}}):new Response('<title>Public import</title>')});
  assert.match(await (await fetch('https://public.test','test')).text(),/Public import/);assert.deepEqual(paths,['/','/page']);
});
test('caps redirect loops',async()=>{
  let calls=0;const fetch=createPublicFetch(publicDns,async()=>{calls++;return new Response(null,{status:302,headers:{location:'/'}})});
  await assert.rejects(fetch('https://public.test','test'),/too many/);assert.equal(calls,6);
});
test('real HTTP transport returns page data and pins both lookup modes',async()=>{
  const http=await import('node:http');
  const server=http.createServer((_req,res)=>res.end('<title>Importable website</title>'));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address && typeof address!=='string');
  const original=http.default.request;
  const {mock}=await import('node:test');
  // Route only the test socket locally after checking the production options.
  const replacement=mock.method(http.default,'request',(url:any,options:any,callback:any)=>{
    assert.equal(url.hostname,'public.test');
    options.lookup('public.test',{all:false},(err:any,ip:any,family:any)=>{assert.equal(err,null);assert.equal(ip,'93.184.215.14');assert.equal(family,4)});
    options.lookup('public.test',{all:true},(err:any,ips:any)=>{assert.equal(err,null);assert.deepEqual(ips,[{address:'93.184.215.14',family:4}])});
    return original(`http://127.0.0.1:${address.port}`,{headers:options.headers},callback);
  });
  try{const fetch=createPublicFetch(publicDns);assert.match(await (await fetch('http://public.test','test')).text(),/Importable website/)}
  finally{replacement.mock.restore();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
test('page, robots, category and image imports never contact an internal listener',async()=>{
  const http=await import('node:http');
  const {fetchPage,discoverCategoryPages}=await import('../src/fetcher.js');
  const {downloadAndStoreImage,downloadFullSizeOnly}=await import('../src/media-store.js');
  let hits=0;
  const server=http.createServer((_req,res)=>{hits++;res.end('private')});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address && typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  try{
    await assert.rejects(fetchPage(base+'/private'),UnsafeScrapeUrl);
    assert.deepEqual(await discoverCategoryPages(base+'/private','ship'),[]);
    assert.equal(await downloadAndStoreImage(base+'/private.png'),null);
    assert.equal(await downloadFullSizeOnly(base+'/thumb/a/b/100px-private.png'),null);
    assert.equal(hits,0);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
