import type { Diagnostic } from '@codemirror/lint';

self.onmessage = async (event:MessageEvent<{id:number;language:'json'|'yaml';text:string}>)=>{
  const {id,language,text}=event.data;
  const diagnostics:Diagnostic[]=[];
  try {
    if (language==='json') {
      const {parser}=await import('@lezer/json');
      parser.parse(text).iterate({enter(node){if(node.type.isError&&diagnostics.length<100)diagnostics.push({from:node.from,to:node.to,severity:'error',source:'JSON',message:'此处不是有效的 JSON 语法'});}});
    } else {
      const {parseAllDocuments}=await import('yaml');
      for(const document of parseAllDocuments(text,{prettyErrors:false,uniqueKeys:true}))for(const [issues,severity] of [[document.errors,'error'],[document.warnings,'warning']] as const)for(const issue of issues){if(diagnostics.length>=100)break;const from=Math.max(0,Math.min(text.length,issue.pos[0]));diagnostics.push({from,to:Math.max(from,Math.min(text.length,issue.pos[1])),severity,source:'YAML',message:issue.message});}
    }
    self.postMessage({id,diagnostics});
  } catch (error) {self.postMessage({id,diagnostics:[],error:error instanceof Error?error.message:String(error)});}
};
