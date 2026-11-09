import { t as translate } from '../../i18n/index.ts';
import { message as uiMessage } from '../../i18n/messages.ts';
import { useEffect, useState } from 'react';
import { PrepareExternalImagePreview, PrepareImagePreview, ReleaseImagePreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/appservice';
import type { ImagePreview } from '../../../bindings/github.com/Sanjeever/termquay/internal/app/models';
import { errorMessage } from '../../lib/errors';

export default function useImageResource(workspace:string,path:string,visible:boolean,external=false) {
  const [resource,setResource]=useState<{key:string;url:string;metadata:ImagePreview}>();
  const [error,setError]=useState<{key:string;message:unknown}>();
  const [version,setVersion]=useState(0);
  const key=`${workspace}\0${path}\0${external}`;
  useEffect(()=>{
    if(!visible)return;
    let ended=false;
    let token='';
    let objectURL='';
    const abort=new AbortController();
    setResource(undefined);setError(undefined);
    const request=external?PrepareExternalImagePreview(workspace,path):PrepareImagePreview(workspace,path);
    const release=(id:string)=>{void ReleaseImagePreview(id).catch(error=>console.error(translate('files:couldNotReleaseImagePreview'),errorMessage(error)));};
    void(async()=>{
      try {
        const metadata=await request;
        if(ended){release(metadata.id);return;}
        token=metadata.id;
        const response=await fetch(metadata.url,{signal:abort.signal,cache:'no-store',credentials:'same-origin',headers:{'X-TermQuay-Image':metadata.id}});
        if(!response.ok)throw uiMessage('files:couldNotReadImageContentHTTP', { value1: response.status });
        const blob=await response.blob();
        if(ended)return;
        objectURL=URL.createObjectURL(blob);
        setResource({key,url:objectURL,metadata});
      } catch(error) {
        if(token){release(token);token='';}
        if(!ended)setError({key,message:error});
      }
    })();
    return()=>{ended=true;abort.abort();request.cancel();if(token)release(token);if(objectURL)URL.revokeObjectURL(objectURL);setResource(undefined);};
  },[key,visible,version]);
  return {resource:visible&&resource?.key===key?resource:undefined,error:visible&&error?.key===key?errorMessage(error.message):'',retry:()=>setVersion(value=>value+1),decodeFailed:()=>setError({key,message:uiMessage('files:couldNotDecodeImageReloadOrDownloadThe')})};
}
