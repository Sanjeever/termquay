export function snippetParameters(body:string):string[]{return [...new Set(Array.from(body.matchAll(/\{\{([A-Za-z_][A-Za-z_0-9]{0,63})\}\}/g),match=>match[1]))];}
export function expandSnippet(body:string,values:Record<string,string>):{text:string;error:string}{
  const parts:string[]=[];let offset=0;let bytes=0;const encoder=new TextEncoder();
  function append(value:string){bytes+=encoder.encode(value).length;if(bytes>256*1024-16)return false;parts.push(value);return true;}
  for(const match of body.matchAll(/\{\{([A-Za-z_][A-Za-z_0-9]{0,63})\}\}/g)){
    if(values[match[1]]===undefined)return {text:'',error:`缺少参数 ${match[1]}`};
    if(!append(body.slice(offset,match.index))||!append(values[match[1]]))return{text:'',error:'替换后内容超过终端输入上限（256 KiB）'};
    offset=match.index!+match[0].length;
  }
  if(!append(body.slice(offset)))return{text:'',error:'替换后内容超过终端输入上限（256 KiB）'};
  return{text:parts.join(''),error:''};
}
