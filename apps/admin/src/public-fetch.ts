// Resolve and pin every scraper connection to a validated public address.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
const blocked = new BlockList();
for (const [ip, bits] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8],
  ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24],
  ['192.88.99.0',24], ['192.168.0.0',16], ['198.18.0.0',15],
  ['198.51.100.0',24], ['203.0.113.0',24], ['224.0.0.0',4], ['240.0.0.0',4],
] as const) blocked.addSubnet(ip, bits, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::',3,'ipv6');
for (const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked.addSubnet(ip,bits,'ipv6');
export class UnsafeScrapeUrl extends Error {
  readonly statusCode = 400;
  constructor() { super('The scraper can only import from public HTTP or HTTPS websites.'); }
}
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address,'ipv4');
  // Only global unicast IPv6; reject mapped IPv4, local and transition ranges.
  return family === 6 && globalV6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
type Address = { address: string; family: number };
type Resolver = (host: string) => Promise<Address[]>;
export async function resolvePublicTarget(input: string | URL,
  resolve: Resolver = host => lookup(host,{all:true,verbatim:true}),
): Promise<{url: URL; address: Address}> {
  const url = new URL(input);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new UnsafeScrapeUrl();
  const host = url.hostname.replace(/^\[|\]$/g,'');
  const answers = isIP(host) ? [{address:host,family:isIP(host)}] : await resolve(host);
  if (!answers.length || answers.some(a => !isPublicAddress(a.address))) throw new UnsafeScrapeUrl();
  return {url,address:answers[0]};
}
type Transport = (target: Awaited<ReturnType<typeof resolvePublicTarget>>, ua: string) => Promise<Response>;
const requestPublic: Transport = ({url,address},ua) => new Promise((resolve,reject) => {
  const req = (url.protocol === 'https:' ? https.request : http.request)(url,{
    agent:false, headers:{'User-Agent':ua,'Accept-Encoding':'identity'},
    // Original hostname remains intact for Host/SNI and certificate validation.
    lookup: (_host,options,callback) => options.all
      ? callback(null,[address]) : callback(null,address.address,address.family),
  },res => {
    const chunks: Buffer[] = []; let size = 0;
    res.on('data',(chunk: Buffer) => {
      size += chunk.length;
      if (size > 5*1024*1024) req.destroy(new Error('Scraped page exceeds the 5 MiB limit.'));
      else chunks.push(chunk);
    });
    res.on('error',reject);
    res.on('end',() => {
      const headers = new Headers();
      for (const [k,v] of Object.entries(res.headers)) if(v !== undefined) headers.set(k,Array.isArray(v)?v.join(', '):v);
      const status = res.statusCode || 502;
      resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers}));
    });
  });
  const timer = setTimeout(() => req.destroy(new Error('Scraped website request timed out.')),15_000);
  req.on('close',() => clearTimeout(timer)); req.on('error',reject); req.end();
});
// Injectable DNS/transport allow deterministic security regression tests.
export function createPublicFetch(resolve?: Resolver, transport: Transport = requestPublic) {
  return async (input: string | URL,ua: string): Promise<Response> => {
    let url = new URL(input);
    for(let redirects=0;redirects<=5;redirects++) {
      const target = await resolvePublicTarget(url,resolve);
      const res = await transport(target,ua);
      if(![301,302,303,307,308].includes(res.status) || !res.headers.has('location')) return res;
      if(redirects===5) throw new Error('Scraped website redirected too many times.');
      url = new URL(res.headers.get('location')!,url);
    }
    throw new Error('Scraped website redirected too many times.');
  };
}
export const publicFetch = createPublicFetch();
