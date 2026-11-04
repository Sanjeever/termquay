export function isImagePath(path:string) { return /\.(png|jpe?g|gif|webp)$/i.test(path); }
export function isMarkdownPath(path:string) { return /\.(md|markdown|mdown|mkd)$|(?:^|\/)(readme|changelog|changes)$/i.test(path); }

export type DocumentTarget = {kind:'remote';path:string;hash:string}|{kind:'external';url:string}|{kind:'anchor';hash:string}|{kind:'blocked'};
export function documentTarget(documentPath:string,target:string):DocumentTarget {
  if (!target.trim()) return {kind:'blocked'};
  try {
    const base='https://termquay.invalid'+documentPath.split('/').map(encodeURIComponent).join('/');
    const url=new URL(target,base);
    if(url.username||url.password||!['http:','https:'].includes(url.protocol))return {kind:'blocked'};
    if(url.origin!=='https://termquay.invalid')return {kind:'external',url:url.href};
    const path=decodeURIComponent(url.pathname);
    if(path===documentPath&&url.hash)return {kind:'anchor',hash:url.hash};
    return {kind:'remote',path,hash:url.hash};
  } catch {return {kind:'blocked'};}
}
