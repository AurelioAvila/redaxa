// Private desktop subprocess protocol. Never expose a listening socket or write
// credentials/findings to disk. The parent owns the only stdin/stdout handles.
import {createInterface} from 'node:readline';
import {scanFullRepository} from '../dist/repository-full.js';
import {demoReport,parseRepository} from '../dist/repository-scanner.js';

const input=createInterface({input:process.stdin,crlfDelay:Infinity});
const abort=new AbortController();
let started=false,finished=false;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
input.on('close',()=>{if(!finished)abort.abort();});
input.on('line',line=>{
 if(line.length>32_768){abort.abort();return;}
 let message;try{message=JSON.parse(line);}catch{return;}
 if(message.type==='cancel'){abort.abort();return;}
 if(started||message.type!=='scan')return;
 started=true;
 void (async()=>{
  try{
   if(message.demo===true){send({type:'result',report:demoReport(true)});return;}
   parseRepository(message.url);
   if(typeof message.accessToken!=='string'||message.accessToken.length>16_384||!message.accessToken){throw new Error('PRO_REQUIRED');}
   send({type:'progress',progress:{stage:'Checking Pro access',checked:0,findings:0}});
   const response=await fetch('https://promptshield-beta.vercel.app/api/account',{
    headers:{Authorization:'Bearer '+message.accessToken},redirect:'error',
    signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20_000)])
   });
   message.accessToken='';
   if(!response.ok)throw new Error('PRO_REQUIRED');
   const account=await response.json();
   if(account.active!==true||account.repositoryAccess!==true)throw new Error('PRO_REQUIRED');
   const report=await scanFullRepository(message.url,abort.signal,true,progress=>send({type:'progress',progress}));
   if(abort.signal.aborted)throw new Error('CANCELLED');
   send({type:'result',report});
  }catch(error){
   const code=abort.signal.aborted?'CANCELLED':error?.message==='PRO_REQUIRED'?'PRO_REQUIRED':'SCAN_FAILED';
   send({type:'error',code,error:code==='PRO_REQUIRED'?'Sign in to an active Pro account to check repositories.':code==='CANCELLED'?'Repository check cancelled.':'Repository could not be checked. Check the public GitHub URL and your connection, then try again.'});
  }finally{
   finished=true;input.close();process.stdin.destroy();
  }
 })();
});
